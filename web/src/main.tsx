import './storageMigrate'; // first: copies pre-rename storage keys before any module reads them
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<App />);
