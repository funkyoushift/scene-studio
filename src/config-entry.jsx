import React from 'react';
import {createRoot} from 'react-dom/client';
import './studio.css';

createRoot(document.getElementById('root')).render(<main className="studio-welcome config-studio"><small>SCENE STUDIO · TWITCH PLAYER</small><h1>Create in your studio.</h1><p>Set up your overlay, build with AI, upload media and run games on the Scene Studio website.</p><a href="https://www.funkyoushift.com/scene-studio/" target="_blank" rel="noopener noreferrer">Open Scene Studio ↗</a><p>Sign in with the Twitch account that owns this channel. Published scenes and supported game settings update this player automatically.</p><p className="studio-note">Keep Scene Studio activated on your channel. During Hosted Test, viewers must be added as testers and accept Twitch’s test-extension notice.</p></main>);
