import { render } from 'preact';
import { purgeStoredTokensIfShared } from './storage';
import { App } from './app/App';
import './app/app.css';

purgeStoredTokensIfShared();

const root = document.getElementById('app');
if (root) render(<App />, root);
