import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";

// --- REMOTE VIDEO COMPONENT ---
const RemoteVideo = ({ stream, peerName }) => {
    const videoRef = useRef(null);
    useEffect(() => {
        if (videoRef.current && stream) videoRef.current.srcObject = stream;
    }, [stream]);
    return (
        <div style={{ backgroundColor: '#222', borderRadius: '12px', overflow: 'hidden', position: 'relative', width: '100%', maxWidth: '400px', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #333' }}>
            <video playsInline autoPlay ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', bottom: '12px', left: '12px', color: 'white', backgroundColor: 'rgba(0,0,0,0.6)', padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: '500', backdropFilter: 'blur(4px)' }}>
                {peerName}
            </div>
        </div>
    );
};

export default function Room() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const urlPassword = searchParams.get("pwd");

    // Securely pull the user's identity from Clerk (Google Auth)
    const { user } = useUser();
    const myName = user?.fullName || user?.firstName || "Guest User";

    const REST_URL = "https://zoom-clone-g1m4.onrender.com";
    const WS_URL = "wss://zoom-clone-g1m4.onrender.com";

    const [isValidating, setIsValidating] = useState(!!urlPassword);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [manualPassword, setManualPassword] = useState("");
    const [authError, setAuthError] = useState("");
    const [showShareModal, setShowShareModal] = useState(false);

    // Screen sharing state
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const screenStreamRef = useRef(null);

    const activePassword = urlPassword || manualPassword;

    const clientId = useRef(Math.random().toString(36).substring(2, 10)).current;
    const userVideoRef = useRef(null);
    const wsRef = useRef(null);
    const peersRef = useRef({});
    const peerNamesRef = useRef({});

    const [localStream, setLocalStream] = useState(null);
    const [remotePeers, setRemotePeers] = useState([]);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);

    useEffect(() => {
        if (urlPassword) validatePassword(urlPassword);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const validatePassword = async (passwordToCheck) => {
        setIsValidating(true);
        setAuthError("");
        try {
            const response = await fetch(`${REST_URL}/validate-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room_id: id, password: passwordToCheck })
            });
            if (response.ok) {
                setIsAuthorized(true);
                startMeeting();
            } else {
                setAuthError("Invalid Room Password");
            }
        } catch (error) {
            setAuthError("Could not connect to server");
        } finally {
            setIsValidating(false);
        }
    };

    const startMeeting = async () => {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setLocalStream(stream);
            if (userVideoRef.current) userVideoRef.current.srcObject = stream;

            const ws = new WebSocket(`${WS_URL}/ws/${id}/${clientId}`);
            wsRef.current = ws;

            ws.onmessage = async (event) => {
                const message = JSON.parse(event.data);

                if (message.type === "all-users") {
                    message.users.forEach(async (peerId) => {
                        const pc = createPeerConnection(peerId, stream, ws);
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        ws.send(JSON.stringify({ type: "offer", offer, target_id: peerId, sender_id: clientId, sender_name: myName }));
                    });
                }
                else if (message.type === "offer") {
                    peerNamesRef.current[message.sender_id] = message.sender_name || "Guest";
                    updatePeerNameState(message.sender_id, message.sender_name);

                    const pc = createPeerConnection(message.sender_id, stream, ws);
                    await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    ws.send(JSON.stringify({ type: "answer", answer, target_id: message.sender_id, sender_id: clientId, sender_name: myName }));
                }
                else if (message.type === "answer") {
                    peerNamesRef.current[message.sender_id] = message.sender_name || "Guest";
                    updatePeerNameState(message.sender_id, message.sender_name);

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
                        delete peerNamesRef.current[disconnectedId];
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
            if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(track => track.stop());
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
                return [...prevPeers, { peerId: peerId, stream: event.streams[0], peerName: peerNamesRef.current[peerId] || "Connecting..." }];
            });
        };
        return pc;
    };

    const updatePeerNameState = (id, newName) => {
        setRemotePeers((prev) => prev.map(p => p.peerId === id ? { ...p, peerName: newName } : p));
    };

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

    // --- Mesh Network Screen Share Logic with Mobile Checking ---
    const toggleScreenShare = async () => {
        if (!isScreenSharing) {
            try {
                // 1. Check if the browser supports screen sharing
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                    alert("Screen sharing is not supported on this browser or mobile device.");
                    return;
                }

                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenVideoTrack = screenStream.getVideoTracks()[0];

                // Loop through ALL peers and swap their video track
                Object.values(peersRef.current).forEach(pc => {
                    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
                    if (sender) sender.replaceTrack(screenVideoTrack);
                });

                // Update local UI
                if (userVideoRef.current) userVideoRef.current.srcObject = screenStream;
                screenStreamRef.current = screenStream;
                setIsScreenSharing(true);

                // Listen for the native browser "Stop sharing" popup button
                screenVideoTrack.onended = () => {
                    stopScreenSharing();
                };
            } catch (error) {
                console.error("Error sharing screen:", error);
                // 2. Alert the user if they cancel or if the OS blocks the request
                alert("Could not share screen. It may be blocked by your device.");
            }
        } else {
            stopScreenSharing();
        }
    };

    const stopScreenSharing = () => {
        if (localStream && peersRef.current) {
            const webcamTrack = localStream.getVideoTracks()[0];

            // Revert track for ALL peers back to the webcam
            Object.values(peersRef.current).forEach(pc => {
                const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
                if (sender && webcamTrack) sender.replaceTrack(webcamTrack);
            });

            // Revert local UI
            if (userVideoRef.current) userVideoRef.current.srcObject = localStream;
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(track => track.stop());
                screenStreamRef.current = null;
            }
            setIsScreenSharing(false);
        }
    };

    const copyMeetingDetails = () => {
        const inviteText = `Join my Zoom Clone Meeting!\n\nRoom ID: ${id}\nPasscode: ${activePassword}\n\nOne-Click Join Link:\n${window.location.href}`;
        navigator.clipboard.writeText(inviteText);
        alert("Meeting details copied to clipboard!");
        setShowShareModal(false);
    };

    const leaveRoom = () => navigate("/");

    if (isValidating) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#111', color: 'white' }}>
                <div style={{ fontSize: '40px', marginBottom: '20px', animation: 'spin 2s linear infinite' }}>⏳</div>
                <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                <h2 style={{ fontWeight: 'normal' }}>Joining meeting...</h2>
                <p style={{ color: '#888' }}>Authenticating secure connection</p>
            </div>
        );
    }

    if (!isAuthorized) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#111' }}>
                <div style={{ backgroundColor: '#1c1c1c', padding: '3rem', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', textAlign: 'center', color: 'white', maxWidth: '400px', width: '90%' }}>
                    <h2 style={{ margin: '0 0 1rem 0' }}>🔒 Meeting Locked</h2>
                    <p style={{ color: '#ff4d4f', margin: '0 0 1.5rem 0', minHeight: '20px' }}>{authError}</p>
                    <input
                        type="password"
                        placeholder="Enter Meeting Passcode"
                        value={manualPassword}
                        onChange={(e) => setManualPassword(e.target.value)}
                        style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '6px', border: '1px solid #444', backgroundColor: '#2a2a2a', color: 'white', marginBottom: '1.5rem', boxSizing: 'border-box' }}
                    />
                    <button
                        onClick={() => validatePassword(manualPassword)}
                        style={{ width: '100%', padding: '14px', backgroundColor: '#0b5cff', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}
                    >
                        Join Meeting
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ backgroundColor: '#111', minHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: 'white' }}>

            {/* Share Modal */}
            {showShareModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ backgroundColor: '#222', padding: '2rem', borderRadius: '12px', maxWidth: '400px', width: '90%', textAlign: 'left', border: '1px solid #333' }}>
                        <h3 style={{ marginTop: 0, borderBottom: '1px solid #444', paddingBottom: '10px', color: '#fff' }}>Meeting Information</h3>
                        <div style={{ margin: '15px 0', fontSize: '16px', color: '#ccc' }}>
                            <p><strong>Room ID:</strong> <span style={{ fontFamily: 'monospace', backgroundColor: '#111', padding: '4px 8px', borderRadius: '4px', color: '#4ade80' }}>{id}</span></p>
                            <p><strong>Passcode:</strong> <span style={{ fontFamily: 'monospace', backgroundColor: '#111', padding: '4px 8px', borderRadius: '4px', color: '#4ade80' }}>{activePassword}</span></p>
                        </div>
                        <p style={{ fontSize: '14px', color: '#888', wordBreak: 'break-all', marginBottom: '20px' }}>
                            <strong>Direct Link:</strong><br /> <span style={{ color: '#60a5fa' }}>{window.location.href}</span>
                        </p>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={copyMeetingDetails} style={{ flex: 1, padding: '12px', backgroundColor: '#0b5cff', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Copy Invite</button>
                            <button onClick={() => setShowShareModal(false)} style={{ flex: 1, padding: '12px', backgroundColor: '#333', color: '#fff', border: '1px solid #555', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div style={{ padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1a1a1a', borderBottom: '1px solid #2a2a2a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button onClick={() => setShowShareModal(true)} style={{ background: 'none', border: 'none', color: '#2ecc71', cursor: 'pointer', fontSize: '18px', padding: '0' }} title="Meeting Info">
                        🛡️
                    </button>
                    <span style={{ fontWeight: 'bold', letterSpacing: '1px' }}>Zoom Clone</span>
                </div>
                <div style={{ backgroundColor: '#dc3545', color: 'white', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                    REC
                </div>
            </div>

            {/* Video Grid Area */}
            <div style={{ flex: 1, padding: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '20px', overflowY: 'auto' }}>

                {/* Local Video */}
                <div style={{ backgroundColor: '#222', borderRadius: '12px', overflow: 'hidden', position: 'relative', width: '100%', maxWidth: '400px', aspectRatio: '16/9', border: '1px solid #333' }}>
                    <video playsInline muted autoPlay ref={userVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: isScreenSharing ? 'none' : 'scaleX(-1)' }} />
                    <div style={{ position: 'absolute', bottom: '12px', left: '12px', color: 'white', backgroundColor: 'rgba(0,0,0,0.6)', padding: '6px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: '500', backdropFilter: 'blur(4px)' }}>
                        {myName} {isScreenSharing ? "(Presenting)" : ""} {isAudioEnabled ? "" : "🔇"}
                    </div>
                </div>

                {/* Remote Videos */}
                {remotePeers.map((peer) => (
                    <RemoteVideo key={peer.peerId} stream={peer.stream} peerName={peer.peerName} />
                ))}
            </div>

            {/* Control Bar */}
            <div style={{ backgroundColor: '#1a1a1a', padding: '15px 20px', display: 'flex', justifyContent: 'center', gap: '20px', borderTop: '1px solid #2a2a2a' }}>

                <button onClick={toggleAudio} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: isAudioEnabled ? 'white' : '#ff4d4f', cursor: 'pointer', width: '60px' }}>
                    <div style={{ fontSize: '24px', backgroundColor: isAudioEnabled ? '#333' : 'rgba(255, 77, 79, 0.1)', padding: '12px', borderRadius: '50%', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isAudioEnabled ? "🎤" : "🔇"}
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: '500' }}>{isAudioEnabled ? "Mute" : "Unmute"}</span>
                </button>

                <button onClick={toggleVideo} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: isVideoEnabled ? 'white' : '#ff4d4f', cursor: 'pointer', width: '60px' }}>
                    <div style={{ fontSize: '24px', backgroundColor: isVideoEnabled ? '#333' : 'rgba(255, 77, 79, 0.1)', padding: '12px', borderRadius: '50%', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isVideoEnabled ? "📷" : "🚫"}
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: '500' }}>{isVideoEnabled ? "Stop" : "Start"}</span>
                </button>

                <button onClick={toggleScreenShare} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: isScreenSharing ? '#4ade80' : 'white', cursor: 'pointer', width: '60px' }}>
                    <div style={{ fontSize: '24px', backgroundColor: isScreenSharing ? 'rgba(74, 222, 128, 0.1)' : '#333', padding: '12px', borderRadius: '50%', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        💻
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: '500' }}>{isScreenSharing ? "Sharing" : "Share"}</span>
                </button>

                <button onClick={() => setShowShareModal(true)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', width: '60px' }}>
                    <div style={{ fontSize: '24px', backgroundColor: 'rgba(74, 222, 128, 0.1)', padding: '12px', borderRadius: '50%', width: '50px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        👥
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: '500' }}>Invite</span>
                </button>

                <button onClick={leaveRoom} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: '#ff4d4f', cursor: 'pointer', marginLeft: 'auto' }}>
                    <div style={{ fontSize: '16px', backgroundColor: '#ff4d4f', color: 'white', padding: '12px 24px', borderRadius: '8px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50px' }}>
                        End
                    </div>
                </button>

            </div>
        </div>
    );
}