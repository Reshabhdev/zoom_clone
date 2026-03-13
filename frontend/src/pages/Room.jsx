import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";

const RemoteVideo = ({ stream, peerId }) => {
    const videoRef = useRef(null);
    useEffect(() => {
        if (videoRef.current && stream) videoRef.current.srcObject = stream;
    }, [stream]);
    return (
        <div style={{ backgroundColor: '#333', borderRadius: '8px', overflow: 'hidden', position: 'relative', width: '300px', height: '225px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video playsInline autoPlay ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <p style={{ position: 'absolute', bottom: '10px', left: '10px', color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', margin: 0, padding: '5px 10px', borderRadius: '4px', fontSize: '14px' }}>Guest ({peerId.substring(0, 4)})</p>
        </div>
    );
};

export default function Room() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const urlPassword = searchParams.get("pwd");

    // Live Render URLs
    const REST_URL = "https://zoom-clone-g1m4.onrender.com";
    const WS_URL = "wss://zoom-clone-g1m4.onrender.com";

    // Authorization State
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [manualPassword, setManualPassword] = useState("");
    const [authError, setAuthError] = useState("");

    const clientId = useRef(Math.random().toString(36).substring(2, 10)).current;
    const userVideoRef = useRef(null);
    const wsRef = useRef(null);
    const peersRef = useRef({});

    const [localStream, setLocalStream] = useState(null);
    const [remotePeers, setRemotePeers] = useState([]);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);

    // --- 1. AUTHORIZATION LOGIC ---
    useEffect(() => {
        if (urlPassword) {
            validatePassword(urlPassword);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const validatePassword = async (passwordToCheck) => {
        try {
            const response = await fetch(`${REST_URL}/validate-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room_id: id, password: passwordToCheck })
            });

            if (response.ok) {
                setIsAuthorized(true);
                startMeeting(); // Start WebRTC only after auth!
            } else {
                setAuthError("Invalid Room Password");
            }
        } catch (error) {
            setAuthError("Could not connect to server");
        }
    };

    // --- 2. WEBRTC MESH LOGIC (Runs if authorized) ---
    const startMeeting = async () => {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setLocalStream(stream);
            if (userVideoRef.current) userVideoRef.current.srcObject = stream;

            // Connect to the Live WebSocket server
            const ws = new WebSocket(`${WS_URL}/ws/${id}/${clientId}`);
            wsRef.current = ws;

            ws.onmessage = async (event) => {
                const message = JSON.parse(event.data);
                if (message.type === "all-users") {
                    message.users.forEach(async (peerId) => {
                        const pc = createPeerConnection(peerId, stream, ws);
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        ws.send(JSON.stringify({ type: "offer", offer, target_id: peerId, sender_id: clientId }));
                    });
                }
                else if (message.type === "offer") {
                    const pc = createPeerConnection(message.sender_id, stream, ws);
                    await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    ws.send(JSON.stringify({ type: "answer", answer, target_id: message.sender_id, sender_id: clientId }));
                }
                else if (message.type === "answer") {
                    const pc = peersRef.current[message.sender_id];
                    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
                }
                else if (message.type === "ice-candidate") {
                    const pc = peersRef.current[message.sender_id];
                    if (pc) await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
                }
                else if (message.type === "user-disconnected") {
                    const disconnectedId = message.caller_id;
                    if (peersRef.current[disconnectedId]) {
                        peersRef.current[disconnectedId].close();
                        delete peersRef.current[disconnectedId];
                    }
                    setRemotePeers((prev) => prev.filter(peer => peer.peerId !== disconnectedId));
                }
            };
        } catch (error) {
            console.error("Error setting up WebRTC:", error);
        }
    };

    useEffect(() => {
        return () => {
            if (localStream) localStream.getTracks().forEach(track => track.stop());
            Object.values(peersRef.current).forEach(pc => pc.close());
            if (wsRef.current) wsRef.current.close();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const createPeerConnection = (peerId, currentStream, ws) => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        peersRef.current[peerId] = pc;
        currentStream.getTracks().forEach(track => pc.addTrack(track, currentStream));

        pc.onicecandidate = (event) => {
            if (event.candidate && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate, target_id: peerId, sender_id: clientId }));
            }
        };

        pc.ontrack = (event) => {
            setRemotePeers((prevPeers) => {
                const existingPeer = prevPeers.find(p => p.peerId === peerId);
                if (existingPeer) return prevPeers;
                return [...prevPeers, { peerId: peerId, stream: event.streams[0] }];
            });
        };
        return pc;
    };

    // --- UI CONTROLS ---
    const toggleAudio = () => {
        if (localStream) {
            const track = localStream.getAudioTracks()[0];
            track.enabled = !track.enabled;
            setIsAudioEnabled(track.enabled);
        }
    };

    const toggleVideo = () => {
        if (localStream) {
            const track = localStream.getVideoTracks()[0];
            track.enabled = !track.enabled;
            setIsVideoEnabled(track.enabled);
        }
    };

    const copyInviteLink = () => {
        navigator.clipboard.writeText(window.location.href);
        alert("Invite link copied to clipboard!");
    };

    const leaveRoom = () => navigate("/");

    // --- RENDER LOCK SCREEN IF NOT AUTHORIZED ---
    if (!isAuthorized) {
        return (
            <div style={{ marginTop: '10vh' }}>
                <h2>Meeting is Locked</h2>
                <p style={{ color: 'red' }}>{authError}</p>
                <input
                    type="text"
                    placeholder="Enter Password"
                    value={manualPassword}
                    onChange={(e) => setManualPassword(e.target.value)}
                    style={{ padding: '10px', fontSize: '16px', marginRight: '10px' }}
                />
                <button
                    onClick={() => validatePassword(manualPassword)}
                    style={{ padding: '12px 24px', backgroundColor: '#2D8CFF', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                    Unlock & Join
                </button>
            </div>
        );
    }

    // --- RENDER VIDEO ROOM IF AUTHORIZED ---
    return (
        <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2>Meeting Room: {id}</h2>

            {/* Top Action Bar */}
            <div style={{ marginBottom: '20px' }}>
                <button onClick={copyInviteLink} style={{ padding: '8px 16px', backgroundColor: '#e2e8f0', color: '#333', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                    🔗 Copy Invite Link
                </button>
            </div>

            {/* Video Grid */}
            <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '20px', maxWidth: '1000px' }}>
                <div style={{ backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative', width: '300px', height: '225px' }}>
                    <video playsInline muted autoPlay ref={userVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                    <p style={{ position: 'absolute', bottom: '10px', left: '10px', color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', margin: 0, padding: '5px 10px', borderRadius: '4px', fontSize: '14px' }}>You</p>
                </div>
                {remotePeers.map((peer) => (
                    <RemoteVideo key={peer.peerId} stream={peer.stream} peerId={peer.peerId} />
                ))}
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: '15px', marginTop: '20px', padding: '15px', backgroundColor: '#f1f1f1', borderRadius: '10px' }}>
                <button onClick={toggleAudio} style={{ padding: '10px 20px', backgroundColor: isAudioEnabled ? '#fff' : '#ff4d4f', color: isAudioEnabled ? '#333' : '#fff', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                    {isAudioEnabled ? "Mute Mic" : "Unmute Mic"}
                </button>
                <button onClick={toggleVideo} style={{ padding: '10px 20px', backgroundColor: isVideoEnabled ? '#fff' : '#ff4d4f', color: isVideoEnabled ? '#333' : '#fff', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                    {isVideoEnabled ? "Stop Video" : "Start Video"}
                </button>
                <button onClick={leaveRoom} style={{ padding: '10px 20px', backgroundColor: '#ff4d4f', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                    Leave Meeting
                </button>
            </div>
        </div>
    );
}