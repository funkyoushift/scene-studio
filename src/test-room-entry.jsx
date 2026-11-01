import React from 'react';
import {createRoot} from 'react-dom/client';
import TestRoom from './TestRoom.jsx';
import './style.css';
import './test-room.css';
document.body.classList.add('test-room-page');
createRoot(document.getElementById('root')).render(<TestRoom/>);
