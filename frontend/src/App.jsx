// 1. We added RedirectToSignIn to the import list here:
import { SignedIn, SignedOut, SignInButton, UserButton, RedirectToSignIn } from "@clerk/clerk-react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Room from "./pages/Room";

export default function App() {
  return (
    <BrowserRouter>
      {/* Navigation Bar */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 2rem', borderBottom: '1px solid #e5e5e5', backgroundColor: '#f8f9fa' }}>
        <h2 style={{ margin: 0, color: '#2D8CFF' }}>Zoom Clone</h2>
        <SignedIn>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
      </nav>

      {/* Main Content Area */}
      <main style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <Routes>

          <Route path="/" element={
            <>
              <SignedOut>
                <div style={{ marginTop: '10vh' }}>
                  <h1>Welcome to the Zoom Clone</h1>
                  <p style={{ color: '#666', marginBottom: '2rem' }}>Please sign in to make or join a video call.</p>
                  <SignInButton mode="modal">
                    <button style={{ padding: '12px 24px', fontSize: '16px', cursor: 'pointer', backgroundColor: '#2D8CFF', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold' }}>
                      Sign In to Continue
                    </button>
                  </SignInButton>
                </div>
              </SignedOut>

              <SignedIn>
                <Home />
              </SignedIn>
            </>
          } />

          {/* 2. THE FIX IS HERE */}
          <Route path="/room/:id" element={
            <>
              {/* If they are logged in, show the room */}
              <SignedIn>
                <Room />
              </SignedIn>

              {/* If they are NOT logged in, redirect them to the Clerk login screen */}
              <SignedOut>
                <RedirectToSignIn />
              </SignedOut>
            </>
          } />

        </Routes>
      </main>
    </BrowserRouter>
  );
}