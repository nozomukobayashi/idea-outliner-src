import { render } from 'preact';
import { purgeStoredTokensIfShared } from '../storage';
import { SpikeApp } from './SpikeApp';
import './spike.css';

purgeStoredTokensIfShared();

const root = document.getElementById('app');
if (root) render(<SpikeApp />, root);
