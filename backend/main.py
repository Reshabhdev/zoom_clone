from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict
import json
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# 1. Add CORS so React (port 5173) can talk to FastAPI (port 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, change this to your Vercel domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. In-memory database for room passwords
room_passwords = {} # Format: { "room_123": "mysecretpassword" }

# Data models for our REST API
class RoomAuth(BaseModel):
    room_id: str
    password: str

# 3. REST Endpoint: Create a room password
@app.post("/create-room")
def create_room(data: RoomAuth):
    if data.room_id in room_passwords:
        raise HTTPException(status_code=400, detail="Room already exists")
    room_passwords[data.room_id] = data.password
    return {"message": "Room secured"}

# 4. REST Endpoint: Validate a room password
@app.post("/validate-room")
def validate_room(data: RoomAuth):
    if data.room_id not in room_passwords:
        raise HTTPException(status_code=404, detail="Room not found")
    if room_passwords[data.room_id] != data.password:
        raise HTTPException(status_code=401, detail="Invalid password")
    return {"message": "Access granted"}

# --- Existing WebSocket Mesh Network Code Below ---

class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str, client_id: str):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        self.rooms[room_id][client_id] = websocket
        print(f"User {client_id} connected to room: {room_id}")

        existing_users = [cid for cid in self.rooms[room_id] if cid != client_id]
        await websocket.send_text(json.dumps({"type": "all-users", "users": existing_users}))

        for cid, ws in self.rooms[room_id].items():
            if cid != client_id:
                await ws.send_text(json.dumps({"type": "user-joined", "caller_id": client_id}))

    def disconnect(self, websocket: WebSocket, room_id: str, client_id: str):
        if room_id in self.rooms and client_id in self.rooms[room_id]:
            del self.rooms[room_id][client_id]
            for cid, ws in self.rooms[room_id].items():
                import asyncio
                asyncio.create_task(ws.send_text(json.dumps({"type": "user-disconnected", "caller_id": client_id})))
            if not self.rooms[room_id]:
                del self.rooms[room_id]
                # Optional: clean up the password when the room is empty
                if room_id in room_passwords:
                    del room_passwords[room_id]
            print(f"User {client_id} disconnected from room: {room_id}")

    async def send_personal_message(self, message: str, room_id: str, target_client_id: str):
        if room_id in self.rooms and target_client_id in self.rooms[room_id]:
            target_ws = self.rooms[room_id][target_client_id]
            await target_ws.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str):
    await manager.connect(websocket, room_id, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            if "target_id" in message:
                await manager.send_personal_message(data, room_id, message["target_id"])
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id, client_id)