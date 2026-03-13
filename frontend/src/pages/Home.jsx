import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
    const [createPwd, setCreatePwd] = useState("");
    const [joinRoomId, setJoinRoomId] = useState("");
    const [joinPwd, setJoinPwd] = useState("");
    const navigate = useNavigate();

    // The URL to your live Render backend
    const BACKEND_URL = "https://zoom-clone-g1m4.onrender.com";

    const createMeeting = async () => {
        if (!createPwd.trim()) return alert("Please set a room password!");

        const newRoomId = Math.random().toString(36).substring(2, 8);

        try {
            // 1. Tell the live backend to save the password for this room
            const response = await fetch(`${BACKEND_URL}/create-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room_id: newRoomId, password: createPwd })
            });

            if (response.ok) {
                // 2. Navigate to room with password embedded in the URL
                navigate(`/room/${newRoomId}?pwd=${createPwd}`);
            } else {
                alert("Error creating room.");
            }
        } catch (error) {
            console.error(error);
            alert("Cannot connect to server. Make sure your Render backend is live.");
        }
    };

    const joinMeeting = () => {
        if (joinRoomId.trim() && joinPwd.trim()) {
            navigate(`/room/${joinRoomId}?pwd=${joinPwd}`);
        } else {
            alert("Please enter both Room ID and Password");
        }
    };

    return (
        <div style={{ marginTop: '5vh' }}>
            <h1>Dashboard</h1>

            {/* Create Meeting Section */}
            <div style={{ margin: '3rem 0', padding: '2rem', border: '1px solid #ccc', borderRadius: '8px', display: 'inline-block' }}>
                <h3>Create a Secure Meeting</h3>
                <input
                    type="text"
                    placeholder="Set a Room Password"
                    value={createPwd}
                    onChange={(e) => setCreatePwd(e.target.value)}
                    style={{ padding: '10px', fontSize: '16px', marginRight: '10px', marginBottom: '10px' }}
                />
                <br />
                <button onClick={createMeeting} style={{ padding: '12px 24px', backgroundColor: '#00a651', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                    Start New Meeting
                </button>
            </div>

            <p style={{ color: '#666' }}>— OR —</p>

            {/* Join Meeting Section */}
            <div style={{ margin: '3rem 0', padding: '2rem', border: '1px solid #ccc', borderRadius: '8px', display: 'inline-block' }}>
                <h3>Join an Existing Meeting</h3>
                <input
                    type="text" placeholder="Room ID" value={joinRoomId} onChange={(e) => setJoinRoomId(e.target.value)}
                    style={{ padding: '10px', fontSize: '16px', marginRight: '10px', marginBottom: '10px' }}
                />
                <input
                    type="text" placeholder="Password" value={joinPwd} onChange={(e) => setJoinPwd(e.target.value)}
                    style={{ padding: '10px', fontSize: '16px', marginRight: '10px', marginBottom: '10px' }}
                />
                <br />
                <button onClick={joinMeeting} style={{ padding: '12px 24px', backgroundColor: '#2D8CFF', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                    Join
                </button>
            </div>
        </div>
    );
}