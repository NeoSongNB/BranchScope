import {createRoot} from 'react-dom/client';
import {App} from './App';
import {LiveApp} from './LiveApp';
import '@xyflow/react/dist/style.css';
import './style.css';
const live = new URLSearchParams(location.search).get('mode') === 'live';
createRoot(document.getElementById('root')!).render(live ? <LiveApp/> : <App/>);
