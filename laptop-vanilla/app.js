const API_BASE = CONFIG.API_BASE;
const STATUS_POLL_INTERVAL_MS = CONFIG.STATUS_POLL_INTERVAL_MS;
const PROCESSING_POLL_INTERVAL_MS = CONFIG.PROCESSING_POLL_INTERVAL_MS;

let sessionCode = localStorage.getItem('activeSession') || null;
let grid = null;
let pollTimer = null;

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

async function api(path, method="GET", body=null, headers={}) {
    const defaultHeaders = { 'Content-Type': 'application/json' };
    if (sessionCode) defaultHeaders['X-Session-Code'] = sessionCode;
    
    const options = { method, headers: { ...defaultHeaders, ...headers } };
    if (body) options.body = typeof body === 'string' ? body : JSON.stringify(body);
    
    const r = await fetch(`${API_BASE}${path}`, options);
    if (!r.ok) {
        let err;
        try { err = (await r.json()).error; } catch(e) { err = r.statusText; }
        throw new Error(err);
    }
    return await r.json();
}

document.getElementById('btn-new-session').addEventListener('click', async () => {
    try {
        const res = await api('/session/new', 'POST');
        sessionCode = res.session_code;
        localStorage.setItem('activeSession', sessionCode);
        
        document.getElementById('display-session-code').textContent = res.session_code;
        document.getElementById('qr-img').src = `data:image/png;base64,${res.qr_code_base64}`;
        document.getElementById('phone-connection-status').textContent = "⏳ Waiting for phone connection...";
        
        showScreen('session-screen');
        startWaitingForPhone();
    } catch (e) {
        alert("Failed to create session: " + e.message);
    }
});

document.getElementById('btn-view-runs').addEventListener('click', loadResults);
document.getElementById('btn-new-run').addEventListener('click', () => {
    showScreen('home-screen');
});

function startWaitingForPhone() {
    if(pollTimer) clearInterval(pollTimer);

    pollTimer = setInterval(async () => {
        try {
            const status = await api('/status');
            if (status.status === 'recording' || status.calibrated || status.colors_set) {
                document.getElementById('phone-connection-status').textContent = "✓ Phone connected";
                clearInterval(pollTimer);
                setTimeout(() => showSetupStatusScreen(status), 1000);
            }
        } catch (e) { console.error(e); }
    }, STATUS_POLL_INTERVAL_MS);
}

function showSetupStatusScreen(initialStatus) {
    showScreen('setup-status-screen');
    updateSetupUI(initialStatus);

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        try {
            const status = await api('/status');
            updateSetupUI(status);
            
            if (status.status === 'recording') {
                clearInterval(pollTimer);
                showRecordScreen();
            }
        } catch (e) { console.error(e); }
    }, STATUS_POLL_INTERVAL_MS);
}

function updateSetupUI(status) {
    const calEl = document.getElementById('status-calibration');
    const colEl = document.getElementById('status-colors');
    
    if (status.calibrated) calEl.textContent = `✓ Calibrated: ${status.px_per_cm.toFixed(1)} px/cm`;
    if (status.colors_set) colEl.textContent = `✓ Colors set`;
    
    if (status.calibrated && status.colors_set) {
        const btn = document.getElementById('btn-go-record');
        btn.style.display = 'block';
        btn.onclick = () => {
            clearInterval(pollTimer);
            showRecordScreen();
        };
    }
}

function showRecordScreen() {
    showScreen('record-screen');
    const stopBtn = document.getElementById('btn-stop-record');
    stopBtn.disabled = true;
    setTimeout(() => stopBtn.disabled = false, 3000); 
    
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        try {
            const status = await api('/status');
            if (status.status === 'recording' && status.frame_count) {
                document.getElementById('stat-frames').textContent = `Frames: ${status.frame_count}`;
            }
        } catch (e) { console.error(e); }
    }, 1000);
}

document.getElementById('btn-stop-record').addEventListener('click', async () => {
    try {
        if(pollTimer) clearInterval(pollTimer);
        await api('/stop', 'POST', {});
        showProcessingScreen();
    } catch (e) {
        alert("Stop failed: " + e.message);
        showProcessingScreen(); 
    }
});

function showProcessingScreen() {
    showScreen('processing-screen');
    document.getElementById('btn-retry-processing').style.display = 'none';
    document.getElementById('processing-error').textContent = "";
    
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        try {
            const status = await api('/status');
            if (status.status === 'processing') {
                document.getElementById('progress-bar').style.width = `${status.progress * 100}%`;
                document.getElementById('progress-label').textContent = status.progress_label;
            } else if (status.status === 'done') {
                clearInterval(pollTimer);
                document.getElementById('progress-bar').style.width = `100%`;
                document.getElementById('progress-label').textContent = "Done ✓";
                setTimeout(loadResults, 800);
            } else if (status.status === 'error') {
                clearInterval(pollTimer);
                document.getElementById('processing-error').textContent = status.error;
                document.getElementById('btn-retry-processing').style.display = 'block';
            }
        } catch (e) { console.error(e); }
    }, PROCESSING_POLL_INTERVAL_MS);
}

document.getElementById('btn-retry-processing').addEventListener('click', () => {
    api('/stop', 'POST', {}).then(() => showProcessingScreen()).catch(e => alert(e.message));
});

async function loadResults() {
    showScreen('results-screen');
    if (!grid) grid = new Grid('grid-canvas');
    
    try {
        const res = await api('/runs');
        const runs = res.runs.reverse(); 
        grid.setRuns(runs);
        
        const listEl = document.getElementById('run-list');
        listEl.innerHTML = '';
        
        let firstRun = null;

        runs.forEach(r => {
            const item = document.createElement('div');
            item.className = 'run-item';
            
            const swatch = document.createElement('div');
            swatch.className = 'swatch';
            swatch.style.backgroundColor = grid.runColors[r.run_id];
            swatch.onclick = (e) => {
                e.stopPropagation();
                swatch.style.backgroundColor = grid.cycleColor(r.run_id);
            };
            
            const title = document.createElement('div');
            title.className = 'run-title';
            const date = new Date(r.timestamp);
            title.textContent = `Run ${r.session_code} · ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            
            const vis = document.createElement('div');
            vis.className = 'toggle-vis';
            vis.textContent = grid.visibleRuns.has(r.run_id) ? '👁' : '∅';
            vis.onclick = (e) => {
                e.stopPropagation();
                grid.toggleVisibility(r.run_id);
                vis.textContent = grid.visibleRuns.has(r.run_id) ? '👁' : '∅';
            };
            
            item.appendChild(swatch);
            item.appendChild(title);
            item.appendChild(vis);
            
            item.onclick = () => {
                document.querySelectorAll('.run-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                showRunDetails(r);
            };
            
            listEl.appendChild(item);
            if (!firstRun) firstRun = {item, r};
        });
        
        if (firstRun) {
            firstRun.item.classList.add('selected');
            showRunDetails(firstRun.r);
        }
        
    } catch(e) {
        alert("Failed to load runs: " + e.message);
    }
}

function showRunDetails(run) {
    document.getElementById('selected-run-details').style.display = 'block';
    document.getElementById('eq-display').textContent = run.equation.display;
    document.getElementById('eq-type').textContent = `Type: ${run.equation.type}`;
    
    const residualsEl = document.getElementById('residuals-list');
    residualsEl.innerHTML = '';
    for (const [key, val] of Object.entries(run.residuals)) {
        const check = run.winning_curve === key ? ' ✓' : '';
        residualsEl.innerHTML += `<div>${key}: ${val.toFixed(4)}${check}</div>`;
    }
}

document.getElementsByName('vis-toggle').forEach(el => {
    el.addEventListener('change', (e) => {
        grid.setMode(e.target.value);
    });
});

if (sessionCode) {
    document.getElementById('btn-new-session').textContent = "Resume Session";
}

// Offline support registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered.'))
            .catch(err => console.log('Service Worker registration failed: ', err));
    });
}
