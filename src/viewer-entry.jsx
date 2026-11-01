import React from 'react';
import {createRoot} from 'react-dom/client';
import Viewer from './Viewer.jsx';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-600.css';
import './style.css';
createRoot(document.getElementById('root')).render(<Viewer/>);
