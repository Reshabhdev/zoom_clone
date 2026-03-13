import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";

// --- NEW: REUSABLE VIDEO CARD COMPONENT ---
// This handles both local and remote videos, click-to-pin logic, and dynamic sizing
const VideoCard = ({ stream, name, isLocal, isScreenSharing, isAudioEnabled, isPinned, onClick }) => {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current && stream) videoRef.current.srcObject = stream;
    }, [stream]);

    return (
        <div
            onClick={onClick}
            style={{
                backgroundColor: '#222',
                borderRadius: '12px',
                overflow: 'hidden',
                position: 'relative',
                // If pinned, take up full space. If not, act like a normal grid card.
                width: isPinned ? '100%' : '100%',
                maxWidth: isPinned ? '100%' : '320px',
                height: isPinned ? '100%' : 'auto',
                aspectRatio: isPinned ? 'auto' : '16/9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: isPinned ? '2px solid #0b5cff' : '1px solid #333',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: isPinned ? '0 10px 30px rgba(0,0,0,0.5)' : 'none'
            }}
        >
            <video
                playsInline
                muted={isLocal}
                autoPlay
                ref={videoRef}
                style={{
                    width: '100%',
                    height: '100%',
                    // Cover fills the box perfectly. Contain ensures presentations aren't cropped!
                    objectFit: isPinned ? 'contain' : 'cover',
                    transform: (isLocal && !isScreenSharing) ? 'scaleX(-1)' : 'none'
                }}
            />
            <div style={{ position: 'absolute', bottom: '10px', left: '10px', color: 'white', backgroundColor: 'rgba(0,0,0,0.6)', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '500', backdropFilter: 'blur(4px)' }}>
                {name} {isLocal && isScreenSharing ? "(Presenting)" : ""} {isLocal && !isAudioEnabled ? "🔇" : ""}
            </div>
        </div>
    );
};


export default function Room() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const urlPassword = searchParams.get("pwd");

    const { user } = useUser();
    const myName = user?.fullName || user?.firstName || "Guest User";

    const REST_URL = "https://zoom-clone-g1m4.onrender.com";
    const WS_URL = "wss://zoom-clone-g1m4.onrender.com";

    const [isValidating, setIsValidating] = useState(!!urlPassword);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [manualPassword, setManualPassword] = useState("");
    const [authError, setAuthError] = useState("");
    const [showShareModal, setShowShareModal] = useState(false);

    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const screenStreamRef = useRef(null);

    // --- NEW: Spotlight (Pinned Video) State ---
    // null = grid view. 'local' = your video is large. 'peerId' = someone else is large.
    const [pinnedPeerId, setPinnedPeerId] = useState(null);

    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessage, setChatMessage] = useState("");
    const [messages, setMessages] = useState([]);
    const chatScrollRef = useRef(null);

    const activePassword = urlPassword || manualPassword;
    const clientId = useRef(Math.random().toString(36).substring(2, 10)).current;
    const wsRef = useRef(null);
    const peersRef = useRef({});
    const peerNamesRef = useRef({});

    // We use activeLocalStream so React knows exactly which track to feed to your VideoCard
    const [localStream, setLocalStream] = useState(null);
    const [activeLocalStream, setActiveLocalStream] = useState(null);
    const localStreamRef = useRef(null);

    const [remotePeers, setRemotePeers] = useState([]);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);

    useEffect(() => {
        if (urlPassword) validatePassword(urlPassword);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [messages, isChatOpen]);

    // --- NEW: History Trap to Prevent Accidental "Back" Navigations ---
    useEffect(() => {
        // Push a state so there's somewhere for the back button to "land" without leaving
        window.history.pushState(null, null, window.location.href);

        const handlePopState = (e) => {
            // Push it right back again so they stay trapped on this page
            window.history.pushState(null, null, window.location.href);
            alert("Please use the 'End Call' button to leave the meeting.");
        };

        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

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
            setActiveLocalStream(stream);
            localStreamRef.current = stream;

            const ws = new WebSocket(`${WS_URL}/ws/${id}/${clientId}`);
            wsRef.current = ws;

            ws.onmessage = async (event) => {
                const message = JSON.parse(event.data);

                if (message.type === "chat") {
                    setMessages((prev) => [...prev, { sender: message.sender_name, text: message.text, time: message.time, isMe: false }]);
                }
                // --- NEW: Handle Auto-Enlarging Screen Shares ---
                else if (message.type === "screen-share-start") {
                    setPinnedPeerId(message.peerId); // Pin the person who just started sharing
                }
                else if (message.type === "screen-share-stop") {
                    setPinnedPeerId(null); // Return to grid view
                }
                else if (message.type === "all-users") {
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
                    // If the disconnected user was pinned, unpin them
                    setPinnedPeerId(prev => prev === disconnectedId ? null : prev);
                }
            };
        } catch (error) {
            console.error("Error setting up WebRTC:", error);
        }
    };

    useEffect(() => {
        return () => {
            if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
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

    const toggleScreenShare = async () => {
        if (!isScreenSharing) {
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                    alert("Screen sharing is not supported on this browser.");
                    return;
                }

                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenVideoTrack = screenStream.getVideoTracks()[0];

                Object.values(peersRef.current).forEach(pc => {
                    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
                    if (sender) sender.replaceTrack(screenVideoTrack);
                });

                setActiveLocalStream(screenStream);
                screenStreamRef.current = screenStream;
                setIsScreenSharing(true);

                // --- NEW: Pin ourselves and tell everyone else to pin us ---
                setPinnedPeerId('local');
                if (wsRef.current) {
                    wsRef.current.send(JSON.stringify({ type: "screen-share-start", peerId: clientId }));
                }

                screenVideoTrack.onended = () => { stopScreenSharing(); };
            } catch (error) {
                console.error("Error sharing screen:", error);
            }
        } else {
            stopScreenSharing();
        }
    };

    const stopScreenSharing = () => {
        if (localStream && peersRef.current) {
            const webcamTrack = localStream.getVideoTracks()[0];
            Object.values(peersRef.current).forEach(pc => {
                const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
                if (sender && webcamTrack) sender.replaceTrack(webcamTrack);
            });

            setActiveLocalStream(localStream);
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(track => track.stop());
                screenStreamRef.current = null;
            }
            setIsScreenSharing(false);

            // --- NEW: Unpin ourselves and tell everyone else to unpin ---
            setPinnedPeerId(null);
            if (wsRef.current) {
                wsRef.current.send(JSON.stringify({ type: "screen-share-stop", peerId: clientId }));
            }
        }
    };

    const copyMeetingDetails = () => {
        const inviteText = `Join my Zoom Clone Meeting!\n\nRoom ID: ${id}\nPasscode: ${activePassword}\n\nOne-Click Join Link:\n${window.location.href}`;
        navigator.clipboard.writeText(inviteText);
        alert("Meeting details copied to clipboard!");
        setShowShareModal(false);
    };

    const sendChatMessage = (e) => {
        e.preventDefault();
        if (!chatMessage.trim() || !wsRef.current) return;
        const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgPayload = { type: "chat", sender_name: myName, text: chatMessage, time: timeString };
        wsRef.current.send(JSON.stringify(msgPayload));
        setMessages(prev => [...prev, { ...msgPayload, isMe: true }]);
        setChatMessage("");
    };

    // --- NEW: Click-to-Pin Handler ---
    const handlePinVideo = (clickedId) => {
        // If you click an already pinned video, it unpins it. Otherwise, it pins the new one.
        setPinnedPeerId(prev => prev === clickedId ? null : clickedId);
    };

    const leaveRoom = () => {
        if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
        if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(track => track.stop());
        Object.values(peersRef.current).forEach(pc => pc.close());
        if (wsRef.current) wsRef.current.close();
        navigate("/");
    };


    if (isValidating) {
        return (
            <div style={{ position: 'fixed', top: 0, left: 0, height: '100dvh', width: '100vw', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', color: 'white', zIndex: 9999 }}>
                <div style={{ fontSize: '40px', marginBottom: '20px', animation: 'spin 2s linear infinite' }}>⏳</div>
                <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                <h2 style={{ fontWeight: 'normal' }}>Joining meeting...</h2>
            </div>
        );
    }

    if (!isAuthorized) {
        return (
            <div style={{ position: 'fixed', top: 0, left: 0, height: '100dvh', width: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', zIndex: 9999 }}>
                <div style={{ backgroundColor: '#1c1c1c', padding: '3rem', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', textAlign: 'center', color: 'white', maxWidth: '400px', width: '90%' }}>
                    <h2 style={{ margin: '0 0 1rem 0' }}>🔒 Meeting Locked</h2>
                    <p style={{ color: '#ff4d4f', margin: '0 0 1.5rem 0', minHeight: '20px' }}>{authError}</p>
                    <input type="password" placeholder="Enter Meeting Passcode" value={manualPassword} onChange={(e) => setManualPassword(e.target.value)} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '6px', border: '1px solid #444', backgroundColor: '#2a2a2a', color: 'white', marginBottom: '1.5rem', boxSizing: 'border-box' }} />
                    <button onClick={() => validatePassword(manualPassword)} style={{ width: '100%', padding: '14px', backgroundColor: '#0b5cff', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', marginBottom: '10px' }}>Join Meeting</button>
                    <button onClick={() => navigate("/")} style={{ width: '100%', padding: '14px', backgroundColor: 'transparent', color: '#888', border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>Back to Dashboard</button>
                </div>
            </div>
        );
    }

    // Find out who is currently pinned so we can render them in the big box
    const pinnedRemotePeer = remotePeers.find(p => p.peerId === pinnedPeerId);
    const unpinnedRemotePeers = remotePeers.filter(p => p.peerId !== pinnedPeerId);

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, height: '100dvh', width: '100vw', backgroundColor: '#111', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: 'white' }}>

            {showShareModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
                    <div style={{ backgroundColor: '#222', padding: '2rem', borderRadius: '12px', maxWidth: '400px', width: '90%', textAlign: 'left', border: '1px solid #333' }}>
                        <h3 style={{ marginTop: 0, borderBottom: '1px solid #444', paddingBottom: '10px', color: '#fff' }}>Meeting Information</h3>
                        <div style={{ margin: '15px 0', fontSize: '16px', color: '#ccc' }}>
                            <p><strong>Room ID:</strong> <span style={{ fontFamily: 'monospace', backgroundColor: '#111', padding: '4px 8px', borderRadius: '4px', color: '#4ade80' }}>{id}</span></p>
                            <p><strong>Passcode:</strong> <span style={{ fontFamily: 'monospace', backgroundColor: '#111', padding: '4px 8px', borderRadius: '4px', color: '#4ade80' }}>{activePassword}</span></p>
                            <p style={{ fontSize: '14px', wordBreak: 'break-all', marginTop: '15px' }}>
                                <strong>Direct Link:</strong><br />
                                <span style={{ color: '#60a5fa' }}>{window.location.href}</span>
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={copyMeetingDetails} style={{ flex: 1, padding: '12px', backgroundColor: '#0b5cff', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Copy Invite</button>
                            <button onClick={() => setShowShareModal(false)} style={{ flex: 1, padding: '12px', backgroundColor: '#333', color: '#fff', border: '1px solid #555', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1a1a1a', borderBottom: '1px solid #2a2a2a' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button onClick={() => setShowShareModal(true)} style={{ background: 'none', border: 'none', color: '#2ecc71', cursor: 'pointer', fontSize: '18px', padding: '0' }}>🛡️</button>
                    <span style={{ fontWeight: 'bold', letterSpacing: '1px', fontSize: '14px' }}>Zoom Clone</span>
                </div>
                <div style={{ backgroundColor: '#dc3545', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>REC</div>
            </div>

            {/* Middle Layout */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                {/* --- DYNAMIC VIDEO AREA --- */}
                <div style={{
                    flex: 1,
                    padding: '20px',
                    display: 'flex',
                    // If someone is pinned, flex row keeps the big video left and the small ones right
                    flexDirection: pinnedPeerId ? 'row' : 'row',
                    flexWrap: pinnedPeerId ? 'nowrap' : 'wrap',
                    gap: '20px',
                    overflowY: 'auto',
                    justifyContent: 'center'
                }}>

                    {/* THE SPOTLIGHT (PINNED) SECTION */}
                    {pinnedPeerId && (
                        <div style={{ flex: '2', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '60%' }}>
                            {pinnedPeerId === 'local' ? (
                                <VideoCard stream={activeLocalStream} name={myName} isLocal isScreenSharing={isScreenSharing} isAudioEnabled={isAudioEnabled} isPinned onClick={() => handlePinVideo('local')} />
                            ) : pinnedRemotePeer ? (
                                <VideoCard stream={pinnedRemotePeer.stream} name={pinnedRemotePeer.peerName} isPinned onClick={() => handlePinVideo(pinnedRemotePeer.peerId)} />
                            ) : null}
                        </div>
                    )}

                    {/* THE SIDEBAR / GRID SECTION */}
                    <div style={{
                        flex: '1',
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignContent: 'flex-start',
                        gap: '15px',
                        // If there's a spotlight, align the rest to the left like a sidebar. Else center them.
                        justifyContent: pinnedPeerId ? 'flex-start' : 'center',
                        minWidth: '250px'
                    }}>
                        {/* Local Video (Only show here if NOT pinned) */}
                        {pinnedPeerId !== 'local' && (
                            <VideoCard stream={activeLocalStream} name={myName} isLocal isScreenSharing={isScreenSharing} isAudioEnabled={isAudioEnabled} onClick={() => handlePinVideo('local')} />
                        )}

                        {/* Remote Videos (Only show those NOT pinned) */}
                        {unpinnedRemotePeers.map((peer) => (
                            <VideoCard key={peer.peerId} stream={peer.stream} name={peer.peerName} onClick={() => handlePinVideo(peer.peerId)} />
                        ))}
                    </div>

                </div>

                {/* Chat Sidebar Panel */}
                {isChatOpen && (
                    <div style={{ width: '300px', backgroundColor: '#1c1c1c', borderLeft: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '12px 15px', borderBottom: '1px solid #2a2a2a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '14px' }}>Meeting Chat</h3>
                            <button onClick={() => setIsChatOpen(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                        </div>
                        <div ref={chatScrollRef} style={{ flex: 1, padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {messages.length === 0 ? (
                                <p style={{ textAlign: 'center', color: '#666', fontSize: '13px', marginTop: '50%' }}>No messages yet.</p>
                            ) : (
                                messages.map((msg, i) => (
                                    <div key={i} style={{ alignSelf: msg.isMe ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                                        {!msg.isMe && <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', paddingLeft: '4px' }}>{msg.sender}</div>}
                                        <div style={{ backgroundColor: msg.isMe ? '#0b5cff' : '#333', color: 'white', padding: '8px 12px', borderRadius: msg.isMe ? '10px 10px 0 10px' : '10px 10px 10px 0', fontSize: '13px', wordBreak: 'break-word' }}>{msg.text}</div>
                                        <div style={{ fontSize: '9px', color: '#666', marginTop: '4px', textAlign: msg.isMe ? 'right' : 'left', padding: '0 4px' }}>{msg.time}</div>
                                    </div>
                                ))
                            )}
                        </div>
                        <form onSubmit={sendChatMessage} style={{ padding: '12px', borderTop: '1px solid #2a2a2a', display: 'flex', gap: '8px' }}>
                            <input type="text" placeholder="Type..." value={chatMessage} onChange={(e) => setChatMessage(e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #444', backgroundColor: '#2a2a2a', color: 'white', outline: 'none', fontSize: '13px' }} />
                            <button type="submit" style={{ backgroundColor: '#0b5cff', color: 'white', border: 'none', borderRadius: '6px', padding: '0 12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>Send</button>
                        </form>
                    </div>
                )}
            </div>

            {/* --- REFINED SMALLER CONTROL BAR WITH MOBILE SAFE-AREA PADDING --- */}
            <div style={{ backgroundColor: '#1a1a1a', paddingTop: '10px', paddingLeft: '20px', paddingRight: '20px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', gap: '12px', borderTop: '1px solid #2a2a2a' }}>

                <button onClick={toggleAudio} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: isAudioEnabled ? 'white' : '#ff4d4f', cursor: 'pointer', width: '50px' }}>
                    <div style={{ fontSize: '18px', backgroundColor: isAudioEnabled ? '#333' : 'rgba(255, 77, 79, 0.1)', borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' }}>
                        {isAudioEnabled ? "🎤" : "🔇"}
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: '500' }}>{isAudioEnabled ? "Mute" : "Unmute"}</span>
                </button>

                <button onClick={toggleVideo} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: isVideoEnabled ? 'white' : '#ff4d4f', cursor: 'pointer', width: '50px' }}>
                    <div style={{ fontSize: '18px', backgroundColor: isVideoEnabled ? '#333' : 'rgba(255, 77, 79, 0.1)', borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' }}>
                        {isVideoEnabled ? "📷" : "🚫"}
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: '500' }}>{isVideoEnabled ? "Stop" : "Start"}</span>
                </button>

                <button onClick={toggleScreenShare} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: isScreenSharing ? '#4ade80' : 'white', cursor: 'pointer', width: '50px' }}>
                    <div style={{ fontSize: '18px', backgroundColor: isScreenSharing ? 'rgba(74, 222, 128, 0.1)' : '#333', borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' }}>
                        💻
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: '500' }}>{isScreenSharing ? "Sharing" : "Share"}</span>
                </button>

                <button onClick={() => setIsChatOpen(!isChatOpen)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: isChatOpen ? '#0b5cff' : 'white', cursor: 'pointer', width: '50px' }}>
                    <div style={{ fontSize: '18px', backgroundColor: isChatOpen ? 'rgba(11, 92, 255, 0.1)' : '#333', borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' }}>
                        💬
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: '500' }}>Chat</span>
                </button>

                <button onClick={() => setShowShareModal(true)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', width: '50px' }}>
                    <div style={{ fontSize: '18px', backgroundColor: 'rgba(74, 222, 128, 0.1)', borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' }}>
                        👥
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: '500' }}>Invite</span>
                </button>

                <button onClick={leaveRoom} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: '#ff4d4f', cursor: 'pointer', marginLeft: 'auto' }}>
                    <div style={{ fontSize: '13px', backgroundColor: '#ff4d4f', color: 'white', padding: '0 20px', borderRadius: '6px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '38px', transition: '0.2s' }}>
                        End Call
                    </div>
                </button>

            </div>
        </div>
    );
}