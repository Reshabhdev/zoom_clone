import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
    const [createPwd, setCreatePwd] = useState("");
    const [joinRoomId, setJoinRoomId] = useState("");
    const [joinPwd, setJoinPwd] = useState("");
    const navigate = useNavigate();

    const BACKEND_URL = "https://zoom-clone-g1m4.onrender.com";

    const createMeeting = async () => {
        if (!createPwd.trim()) return alert("Please set a room passcode!");

        const newRoomId = Math.random().toString(36).substring(2, 8);

        try {
            const response = await fetch(`${BACKEND_URL}/create-room`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room_id: newRoomId, password: createPwd })
            });

            if (response.ok) {
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
            alert("Please enter both Room ID and Passcode");
        }
    };

    return (
        <div className="home-wrapper">
            {/* Embedded CSS for beautiful animations and pseudo-classes */}
            <style>{`
        body { margin: 0; font-family: 'Inter', system-ui, sans-serif; }
        .home-wrapper {
          min-height: 100vh;
          background: radial-gradient(circle at top left, #e0e7ff 0%, #f3f4f6 50%, #eff6ff 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 5vh 20px;
          box-sizing: border-box;
        }
        .hero-title {
          font-size: 3.5rem;
          font-weight: 800;
          background: linear-gradient(135deg, #0b5cff 0%, #9333ea 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 0.5rem;
          line-height: 1.2;
        }
        .hero-subtitle {
          font-size: 1.25rem;
          color: #4b5563;
          margin-top: 0;
          font-weight: 500;
        }
        .card-container {
          display: flex;
          justify-content: center;
          gap: 40px;
          flex-wrap: wrap;
          width: 100%;
          max-width: 900px;
          margin-top: 3rem;
        }
        .action-card {
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.5);
          padding: 2.5rem;
          border-radius: 24px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.04);
          flex: 1;
          min-width: 320px;
          display: flex;
          flex-direction: column;
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .action-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 30px 60px rgba(11, 92, 255, 0.1);
        }
        .icon-box {
          width: 60px;
          height: 60px;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          margin-bottom: 1.5rem;
          box-shadow: 0 10px 20px rgba(0,0,0,0.05);
        }
        .custom-input {
          width: 100%;
          padding: 14px 16px;
          font-size: 16px;
          border: 2px solid #e5e7eb;
          border-radius: 12px;
          margin-bottom: 20px;
          box-sizing: border-box;
          background-color: #ffffff;
          transition: all 0.2s ease;
          outline: none;
        }
        .custom-input:focus {
          border-color: #0b5cff;
          box-shadow: 0 0 0 4px rgba(11, 92, 255, 0.15);
        }
        .input-label {
          display: block;
          font-size: 12px;
          font-weight: 700;
          color: #6b7280;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .btn-primary {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #0b5cff 0%, #2563eb 100%);
          color: white;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          font-weight: bold;
          font-size: 16px;
          box-shadow: 0 10px 20px rgba(11, 92, 255, 0.2);
          transition: all 0.3s ease;
        }
        .btn-primary:hover {
          box-shadow: 0 15px 25px rgba(11, 92, 255, 0.4);
          transform: scale(1.02);
        }
        .btn-secondary {
          width: 100%;
          padding: 16px;
          background: white;
          color: #0b5cff;
          border: 2px solid #0b5cff;
          border-radius: 12px;
          cursor: pointer;
          font-weight: bold;
          font-size: 16px;
          transition: all 0.3s ease;
        }
        .btn-secondary:hover {
          background: #eff6ff;
          transform: scale(1.02);
          box-shadow: 0 10px 20px rgba(11, 92, 255, 0.1);
        }
      `}</style>

            {/* Hero Header */}
            <div style={{ textAlign: 'center', marginTop: '4vh' }}>
                <h1 className="hero-title">Meetings, Redefined.</h1>
                <p className="hero-subtitle">Crystal clear video. Secure connections. Instant access.</p>
            </div>

            {/* Main Content Grid */}
            <div className="card-container">

                {/* CREATE MEETING CARD */}
                <div className="action-card">
                    <div className="icon-box" style={{ background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', color: '#0b5cff' }}>
                        📹
                    </div>
                    <h2 style={{ fontSize: '1.75rem', color: '#111827', marginTop: '0', marginBottom: '0.5rem' }}>New Meeting</h2>
                    <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '15px', lineHeight: '1.5' }}>Generate a secure, private room and invite your team instantly.</p>

                    <div style={{ marginTop: 'auto' }}>
                        <label className="input-label">Set a Passcode</label>
                        <input
                            type="text"
                            className="custom-input"
                            placeholder="e.g. secret123"
                            value={createPwd}
                            onChange={(e) => setCreatePwd(e.target.value)}
                        />
                        <button className="btn-primary" onClick={createMeeting}>
                            Start Meeting
                        </button>
                    </div>
                </div>

                {/* JOIN MEETING CARD */}
                <div className="action-card">
                    <div className="icon-box" style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', color: '#16a34a' }}>
                        🔗
                    </div>
                    <h2 style={{ fontSize: '1.75rem', color: '#111827', marginTop: '0', marginBottom: '0.5rem' }}>Join Meeting</h2>
                    <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '15px', lineHeight: '1.5' }}>Have an invite? Enter the room details below to connect.</p>

                    <div style={{ marginTop: 'auto' }}>
                        <div style={{ display: 'flex', gap: '15px' }}>
                            <div style={{ flex: 1 }}>
                                <label className="input-label">Room ID</label>
                                <input
                                    type="text"
                                    className="custom-input"
                                    placeholder="abc123"
                                    value={joinRoomId}
                                    onChange={(e) => setJoinRoomId(e.target.value)}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label className="input-label">Passcode</label>
                                <input
                                    type="password"
                                    className="custom-input"
                                    placeholder="••••••••"
                                    value={joinPwd}
                                    onChange={(e) => setJoinPwd(e.target.value)}
                                />
                            </div>
                        </div>

                        <button className="btn-secondary" onClick={joinMeeting}>
                            Join Now
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}