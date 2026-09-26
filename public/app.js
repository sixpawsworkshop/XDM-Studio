// OWON XDM2041 Modern Controller Frontend Logic

let socket = null;
let reconnectInterval = null;
let currentDeviceState = {};

// Log database
let readingsLog = [];
let isLoggingPaused = false;

// Running Math Stats
let stats = {
  min: null,
  max: null,
  sum: 0,
  sqSum: 0, // for standard deviation if needed
  count: 0,
  avg: 0
};

// Chart.js Context
let liveChartInstance = null;
let chartDataPoints = [];
let isChartPaused = false;

// Web Audio API Context (For customized system beeps without audio files)
let audioCtx = null;
function playSynthesizedBeep(freq = 1200, durationMs = 120) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.value = freq;
    
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime); // moderate volume
    // smooth volume decay to avoid speaker pops
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (durationMs / 1000));
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + (durationMs / 1000));
  } catch (err) {
    console.warn('Nu s-a putut genera sunetul audio (Web Audio API disabled/unsupported):', err);
  }
}

// Map Multimeter modes to friendly labels, icons, units, and ranges
const MODE_MAP = {
  'VOLT': {
    label: 'Voltaj C.C. (DCV)',
    unit: 'V',
    color: '#22d3ee', // cyan
    icon: 'activity',
    ranges: [
      { name: '50 mV', val: '1' },
      { name: '500 mV', val: '2' },
      { name: '5 V', val: '3' },
      { name: '50 V', val: '4' },
      { name: '500 V', val: '5' },
      { name: '1000 V', val: '6' }
    ]
  },
  'VOLT AC': {
    label: 'Voltaj C.A. (ACV)',
    unit: 'V (AC)',
    color: '#38bdf8', // sky
    icon: 'waveform',
    ranges: [
      { name: '500 mV', val: '1' },
      { name: '5 V', val: '2' },
      { name: '50 V', val: '3' },
      { name: '500 V', val: '4' },
      { name: '750 V', val: '5' }
    ]
  },
  'CURR': {
    label: 'Curent C.C. (DCI)',
    unit: 'A',
    color: '#fbbf24', // amber
    icon: 'zap',
    ranges: [
      { name: '500 µA', val: '1' },
      { name: '5 mA', val: '2' },
      { name: '50 mA', val: '3' },
      { name: '500 mA', val: '4' },
      { name: '5 A', val: '5' },
      { name: '10 A', val: '6' }
    ]
  },
  'CURR AC': {
    label: 'Curent C.A. (ACI)',
    unit: 'A (AC)',
    color: '#f59e0b', // yellow-orange
    icon: 'zap-off',
    ranges: [
      { name: '500 µA', val: '1' },
      { name: '5 mA', val: '2' },
      { name: '50 mA', val: '3' },
      { name: '500 mA', val: '4' },
      { name: '5 A', val: '5' },
      { name: '10 A', val: '6' }
    ]
  },
  'RES': {
    label: 'Rezistență 2-Fire (Ohm)',
    unit: 'Ω',
    color: '#34d399', // emerald
    icon: 'percent',
    ranges: [
      { name: '500 Ω', val: '1' },
      { name: '5 kΩ', val: '2' },
      { name: '50 kΩ', val: '3' },
      { name: '500 kΩ', val: '4' },
      { name: '5 MΩ', val: '5' },
      { name: '50 MΩ', val: '6' }
    ]
  },
  'FRES': {
    label: 'Rezistență 4-Fire (Ohm)',
    unit: 'Ω (4W)',
    color: '#10b981', // green
    icon: 'grid',
    ranges: [
      { name: '500 Ω', val: '1' },
      { name: '5 kΩ', val: '2' },
      { name: '50 kΩ', val: '3' },
      { name: '500 kΩ', val: '4' },
      { name: '5 MΩ', val: '5' },
      { name: '50 MΩ', val: '6' }
    ]
  },
  'CAP': {
    label: 'Capacitate (Farad)',
    unit: 'F',
    color: '#a5b4fc', // indigo
    icon: 'box',
    ranges: [
      { name: '50 nF', val: '1' },
      { name: '500 nF', val: '2' },
      { name: '5 µF', val: '3' },
      { name: '50 µF', val: '4' },
      { name: '500 µF', val: '5' },
      { name: '5 mF', val: '6' },
      { name: '50 mF', val: '7' }
    ]
  },
  'FREQ': {
    label: 'Frecvență (Hertz)',
    unit: 'Hz',
    color: '#60a5fa', // blue
    icon: 'radio',
    ranges: [
      { name: 'Auto Scale Only', val: 'DEF' }
    ]
  },
  'PER': {
    label: 'Periodă (Secunde)',
    unit: 's',
    color: '#818cf8',
    icon: 'clock',
    ranges: [
      { name: 'Auto Scale Only', val: 'DEF' }
    ]
  },
  'TEMP': {
    label: 'Temperatură (RTD)',
    unit: '°C',
    color: '#f87171', // red
    icon: 'thermometer',
    ranges: [
      { name: 'KITS90 RTD', val: '1' },
      { name: 'PT100 RTD', val: '2' }
    ]
  },
  'DIOD': {
    label: 'Test Diodă',
    unit: 'V',
    color: '#f472b6', // pink
    icon: 'chevrons-right',
    ranges: [
      { name: 'Diode Scale', val: 'DEF' }
    ]
  },
  'CONT': {
    label: 'Test Continuitate',
    unit: 'Ω',
    color: '#e879f9', // purple
    icon: 'bell-ring',
    ranges: [
      { name: 'Continuity Scale', val: 'DEF' }
    ]
  }
};

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  initializeLucide();
  initializeChart();
  connectWebSocket();
  setupUIEventListeners();
  
  // Set default stats display
  updateStatsDisplay();
});

// WEBSOCKET CONNECTIONS
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  appendTerminalLog(`Conectare la server prin WebSocket: ${wsUrl}...`, 'tx');
  
  socket = new WebSocket(wsUrl);
  
  socket.onopen = () => {
    console.log('[WS] Connected to backend server');
    appendTerminalLog('Conexiune WebSocket stabilită cu succes.', 'rx');
    clearInterval(reconnectInterval);
    reconnectInterval = null;
    
    // Scan for available physical COM ports on load
    socket.send(JSON.stringify({ type: 'scan_ports' }));
  };
  
  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWebSocketMessage(msg);
    } catch (e) {
      console.error('[WS ERROR] Error parsing server message:', e);
    }
  };
  
  socket.onclose = () => {
    console.warn('[WS] Connection lost. Trying to reconnect...');
    appendTerminalLog('Conexiune pierdută. Încercare de reconectare în 2 secunde...', 'err');
    
    // Set status badge to disconnected state
    updateConnectionBadge(false);
    
    if (!reconnectInterval) {
      reconnectInterval = setInterval(connectWebSocket, 2000);
    }
  };
  
  socket.onerror = (err) => {
    console.error('[WS] Socket error:', err);
  };
}

// MAIN MESSAGE ROUTER
function handleWebSocketMessage(msg) {
  switch (msg.type) {
    // Dynamic full-state update
    case 'state_update':
      currentDeviceState = msg.state;
      syncUIWithDeviceState(msg.state);
      break;
      
    // Live acquisition reading
    case 'reading':
      processIncomingReading(msg);
      break;
      
    // List of scanned serial ports
    case 'ports_list':
      updatePortsDropdown(msg.ports, msg.warning);
      break;
      
    // Raw SCPI Response for Terminal
    case 'scpi_response':
      handleSCPIResponse(msg);
      break;
      
    // Sound beep requested by device
    case 'trigger_local_beep':
      playSynthesizedBeep(1200, 150);
      break;
      
    // Standard server notification
    case 'notification':
      showToast(msg.text, 'info');
      break;
      
    // Error notification
    case 'error':
      showToast(msg.message, 'error');
      break;
  }
}

// SYNCHRONIZE WINDOW ELEMENTS WITH DEVICESTATE
function syncUIWithDeviceState(state) {
  // 1. Connection indicators
  updateConnectionBadge(state.connected, state.isSimulator, state.portName);
  
  // 2. Active primary mode grid highlights
  document.querySelectorAll('#funcGrid button').forEach(btn => {
    const f = btn.getAttribute('data-func');
    if (state.func1 === f || (f === 'VOLT' && state.func1 === 'VOLT DC') || (f === 'CURR' && state.func1 === 'CURR DC')) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 3. Status strings in OLED display
  const friendlyObj = MODE_MAP[state.func1] || { label: state.func1, unit: '' };
  document.getElementById('displayModeBadge').innerText = friendlyObj.label;
  document.getElementById('displayRange').innerText = state.range === 'AUTO' ? 'AUTO SCALE' : `SCALĂ: ${state.range}`;
  
  let speedLabel = 'LENT (L)';
  if (state.speed === 'F') speedLabel = 'RAPID (F)';
  if (state.speed === 'M') speedLabel = 'MEDIU (M)';
  document.getElementById('displaySpeed').innerText = `VITEZĂ: ${speedLabel}`;

  // Speed highlights
  document.getElementById('speedF').className = state.speed === 'F' ? 'flex-1 py-1.5 text-[10px] font-mono font-bold rounded-lg transition-all bg-cyan-500 text-slate-900' : 'flex-1 py-1.5 text-[10px] font-mono font-medium rounded-lg transition-all text-slate-400 hover:text-white hover:bg-slate-800';
  document.getElementById('speedM').className = state.speed === 'M' ? 'flex-1 py-1.5 text-[10px] font-mono font-bold rounded-lg transition-all bg-cyan-500 text-slate-900' : 'flex-1 py-1.5 text-[10px] font-mono font-medium rounded-lg transition-all text-slate-400 hover:text-white hover:bg-slate-800';
  document.getElementById('speedL').className = state.speed === 'L' ? 'flex-1 py-1.5 text-[10px] font-mono font-bold rounded-lg transition-all bg-cyan-500 text-slate-900' : 'flex-1 py-1.5 text-[10px] font-mono font-medium rounded-lg transition-all text-slate-400 hover:text-white hover:bg-slate-800';

  // 4. Beeper highlights
  const beepOn = state.beeper === 'ON';
  document.getElementById('beeperIndicator').className = beepOn ? 'flex items-center gap-1.5 text-emerald-500 font-bold' : 'flex items-center gap-1.5 text-slate-600 line-through';
  document.getElementById('beeperStateToggle').checked = beepOn;

  // 5. Remote indicator
  document.getElementById('remoteIndicator').className = state.remoteMode ? 'px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-blue-400 font-bold text-[10px]' : 'px-2 py-0.5 bg-slate-800/50 border border-slate-700/50 rounded text-slate-600 text-[10px]';

  // 6. Sub-display sync
  const subContainer = document.getElementById('subDisplayContainer');
  if (state.func2 && state.func2 !== 'NONE') {
    subContainer.classList.remove('opacity-40');
    subContainer.classList.add('opacity-100');
  } else {
    subContainer.classList.add('opacity-40');
    subContainer.classList.remove('opacity-100');
    document.getElementById('subReading').innerText = 'OFF';
  }

  // 7. Re-populate range options dynamically
  populateRangeSelectOptions(state.func1, state.range);
}

// DYNAMICALLY MAP SCALES FOR CHOSEN MULTIMETER METHOD
function populateRangeSelectOptions(func, currentRangeValue) {
  const select = document.getElementById('rangeSelect');
  const autoToggle = document.getElementById('rangeAutoToggle');
  
  select.innerHTML = '';
  
  const mapping = MODE_MAP[func];
  if (!mapping) {
    select.innerHTML = '<option value="AUTO">Indisponibil</option>';
    autoToggle.disabled = true;
    return;
  }

  autoToggle.disabled = false;
  
  const isAuto = currentRangeValue === 'AUTO';
  autoToggle.checked = isAuto;
  select.disabled = isAuto;

  if (isAuto) {
    select.classList.add('text-gray-400');
    const opt = document.createElement('option');
    opt.value = 'AUTO';
    opt.text = 'Auto selectat';
    select.appendChild(opt);
  } else {
    select.classList.remove('text-gray-400');
    mapping.ranges.forEach(rng => {
      const opt = document.createElement('option');
      opt.value = rng.val;
      opt.text = rng.name;
      if (currentRangeValue === rng.val) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }
}

// PROCESS RECEIVED VALUE SAMPLING
function processIncomingReading(reading) {
  const mainValueEl = document.getElementById('mainReading');
  const mainUnitEl = document.getElementById('mainUnit');
  const subReadingEl = document.getElementById('subReading');
  const subUnitEl = document.getElementById('subUnit');

  // 1. Overload / Open Circuit Guard
  if (reading.isOL) {
    mainValueEl.innerText = 'O.L';
    mainValueEl.classList.add('ol-active');
    mainUnitEl.innerText = MODE_MAP[reading.func1]?.unit || '';
    
    if (reading.func1 === 'CONT') {
      // open loop, no beep sound
    }
  } else {
    mainValueEl.classList.remove('ol-active');
    
    // Format numeric decimal counts based on reading rate
    let formattedVal = '';
    const val = reading.mainValue;
    
    if (val !== null && !isNaN(val)) {
      // Voltage, current and resistance decimals
      if (['VOLT', 'VOLT AC', 'RES', 'FRES'].includes(reading.func1)) {
        // High, medium, low speed decimals counts
        const decimals = currentDeviceState.speed === 'F' ? 3 : (currentDeviceState.speed === 'M' ? 4 : 5);
        formattedVal = formatEngineering(val, decimals);
      } else if (reading.func1 === 'CAP') {
        formattedVal = formatEngineering(val, 9);
      } else if (reading.func1 === 'TEMP') {
        formattedVal = val.toFixed(2);
      } else {
        formattedVal = val.toFixed(4);
      }
      
      mainValueEl.innerText = formattedVal;
    } else {
      mainValueEl.innerText = reading.mainRaw || '0.0000';
    }
    
    // Set dynamic unit
    mainUnitEl.innerText = getFriendlyUnit(reading.func1, val);
  }

  // 2. Sub display update
  if (reading.func2 !== 'NONE' && reading.subValue !== null) {
    subReadingEl.innerText = parseFloat(reading.subValue).toFixed(2);
    subUnitEl.innerText = 'Hz';
  } else {
    subReadingEl.innerText = 'OFF';
    subUnitEl.innerText = '';
  }

  // 3. Process alarms thresholds limits
  checkAlarmLimits(reading);

  // 4. Update stats and logging if not paused
  if (!isLoggingPaused) {
    updateStatistics(reading);
    pushDataToLogTable(reading);
  }

  // 5. Update live Chart.js visualization
  if (!isChartPaused && !reading.isOL && reading.mainValue !== null) {
    updateChartData(reading.mainValue, reading.timestamp);
  }
}

// CONVERT SCIENTIFIC TO HIGH PRECISION OR CONVENIENT DIGITS
function formatEngineering(value, decimals) {
  const absVal = Math.abs(value);
  
  if (absVal >= 1e6) {
    return (value / 1e6).toFixed(decimals - 2); // Mega scaled
  } else if (absVal >= 1e3) {
    return (value / 1e3).toFixed(decimals - 1); // Kilo scaled
  } else {
    return value.toFixed(decimals); // Normal
  }
}

// RETRIEVE MEASUREMENT SCALES PREFIX FOR DISPLAY UNITS
function getFriendlyUnit(func, rawNum) {
  const base = MODE_MAP[func]?.unit || '';
  if (rawNum === null || isNaN(rawNum)) return base;
  
  const absVal = Math.abs(rawNum);
  
  // Custom prefix adjustments
  if (func === 'RES' || func === 'FRES') {
    if (absVal >= 1e6) return 'MΩ';
    if (absVal >= 1e3) return 'KΩ';
    return 'Ω';
  }
  if (func === 'CAP') {
    if (absVal >= 1e-3) return 'mF';
    if (absVal >= 1e-6) return 'µF';
    if (absVal >= 1e-9) return 'nF';
    return 'F';
  }
  if (func === 'CURR' || func === 'CURR AC') {
    if (absVal < 1e-3) return 'µA';
    if (absVal < 1) return 'mA';
    return 'A';
  }
  return base;
}

// UPDATE STATISTICS METRICS PANEL
function updateStatistics(reading) {
  if (reading.isOL || reading.mainValue === null || isNaN(reading.mainValue)) return;
  const val = reading.mainValue;

  stats.count += 1;
  stats.sum += val;
  stats.sqSum += val * val;

  if (stats.min === null || val < stats.min) stats.min = val;
  if (stats.max === null || val > stats.max) stats.max = val;
  
  stats.avg = stats.sum / stats.count;

  updateStatsDisplay();
}

function updateStatsDisplay() {
  const minVal = stats.min !== null ? formatStatScientific(stats.min) : '-';
  const maxVal = stats.max !== null ? formatStatScientific(stats.max) : '-';
  const avgVal = stats.count > 0 ? formatStatScientific(stats.avg) : '-';

  document.getElementById('statMin').innerText = minVal;
  document.getElementById('statMax').innerText = maxVal;
  document.getElementById('statAvg').innerText = avgVal;
  document.getElementById('statCount').innerText = stats.count;
}

function formatStatScientific(num) {
  if (Math.abs(num) >= 10000 || Math.abs(num) < 0.01) {
    return num.toExponential(4);
  }
  return num.toFixed(5);
}

// TEST AND FLASH SCREEN / SOUND CHIME ON LIMIT OVERFLOWS
function checkAlarmLimits(reading) {
  const lowInput = document.getElementById('alarmLowVal').value;
  const highInput = document.getElementById('alarmHighVal').value;
  const soundToggle = document.getElementById('alarmSoundToggle').checked;
  const flashToggle = document.getElementById('alarmFlashToggle').checked;

  const lowLim = lowInput !== '' ? parseFloat(lowInput) : null;
  const highLim = highInput !== '' ? parseFloat(highInput) : null;

  const mainPanel = document.querySelector('.cyber-panel');
  const warningBar = document.getElementById('alarmWarningBar');
  const flashOverlay = document.getElementById('alarmFlash');

  let triggered = false;
  let reason = '';

  if (!reading.isOL && reading.mainValue !== null) {
    const val = reading.mainValue;
    if (lowLim !== null && val < lowLim) {
      triggered = true;
      reason = `VALOARE PREA MICĂ: ${val.toFixed(4)} < LIMITA ${lowLim}`;
    }
    if (highLim !== null && val > highLim) {
      triggered = true;
      reason = `VALOARE PREA MARE: ${val.toFixed(4)} > LIMITA ${highLim}`;
    }
  }

  // Continuity test special behavior: if value is tiny resistor, beep as per multimeter rule!
  if (reading.func1 === 'CONT' && !reading.isOL && reading.mainValue !== null && reading.mainValue < 30) {
    triggered = true;
    reason = `TEST CONTINUITATE: SCURTCIRCUIT DETECTAT (${reading.mainValue.toFixed(2)} Ω)`;
  }

  if (triggered) {
    // 1. OLED card borders red animation
    mainPanel.classList.add('border-alert-active');
    
    // 2. Alarm warning label active
    warningBar.classList.remove('hidden');
    document.getElementById('alarmWarningText').innerText = reason;

    // 3. Flashing Overlay
    if (flashToggle) {
      flashOverlay.classList.remove('opacity-0');
      flashOverlay.classList.add('opacity-100');
      setTimeout(() => {
        flashOverlay.classList.remove('opacity-100');
        flashOverlay.classList.add('opacity-0');
      }, 150);
    }

    // 4. sound synthesiser beep
    if (soundToggle) {
      // continuity beep sounds higher pitched for electronic quick buzzes
      const freq = reading.func1 === 'CONT' ? 2400 : 800;
      playSynthesizedBeep(freq, 100);
    }
  } else {
    // Reset alert overlays
    mainPanel.classList.remove('border-alert-active');
    warningBar.classList.add('hidden');
    flashOverlay.classList.add('opacity-0');
    flashOverlay.classList.remove('opacity-100');
  }
}

// APPEND READINGS TO SCROLLABLE LOG LIST
function pushDataToLogTable(reading) {
  const tbody = document.getElementById('logTableBody');
  const placeholder = document.getElementById('emptyLogPlaceholder');
  if (placeholder) {
    placeholder.remove();
  }

  const d = new Date(reading.timestamp);
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  
  const idx = readingsLog.length + 1;
  const modeLabel = reading.func1;
  
  let dispVal = '';
  let status = 'OK';
  
  if (reading.isOL) {
    dispVal = 'O.L';
    status = 'Overload';
  } else {
    dispVal = `${reading.mainValue !== null ? reading.mainValue.toExponential(4) : reading.mainRaw} ${getFriendlyUnit(reading.func1, reading.mainValue)}`;
  }

  // Push to local memory log
  const logItem = {
    index: idx,
    timestamp: reading.timestamp,
    formattedTime: timeStr,
    value: reading.mainValue,
    raw: reading.mainRaw,
    unit: getFriendlyUnit(reading.func1, reading.mainValue),
    mode: modeLabel,
    status: status
  };
  readingsLog.push(logItem);

  // Limit in-memory size to prevent leakages
  if (readingsLog.length > 5000) {
    readingsLog.shift();
  }

  // Render on table
  const tr = document.createElement('tr');
  tr.className = 'hover:bg-cyber-darker/60 border-b border-cyber-border/20 transition-all';
  tr.innerHTML = `
    <td class="p-2 text-center text-gray-500 font-semibold">${idx}</td>
    <td class="p-2 text-gray-400 font-mono">${timeStr}</td>
    <td class="p-2 font-bold ${reading.isOL ? 'text-red-400' : 'text-cyan-400'}">${dispVal}</td>
    <td class="p-2 text-gray-400"><span class="px-1.5 py-0.5 bg-cyber-border/50 border border-cyber-border rounded text-[9px] font-mono">${modeLabel}</span></td>
  `;

  tbody.insertBefore(tr, tbody.firstChild);

  // Keep table elements DOM limited for fluid rendering
  if (tbody.children.length > 200) {
    tbody.removeChild(tbody.lastChild);
  }

  document.getElementById('logCount').innerText = `${idx} recs`;
}

// REAL-TIME VISUAL GRAPH (CHART.JS CONFIGS)
function initializeChart() {
  const ctx = document.getElementById('liveChart').getContext('2d');
  
  // Create beautiful futuristic gradients for areas
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(6, 182, 212, 0.15)');
  gradient.addColorStop(1, 'rgba(6, 182, 212, 0.00)');

  liveChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Tensiune/Măsurătoare',
        data: [],
        borderColor: '#06b6d4',
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        pointBackgroundColor: '#00f0ff',
        fill: true,
        backgroundColor: gradient,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { color: 'rgba(51, 65, 85, 0.5)', drawBorder: false },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10, weight: '500' } }
        },
        y: {
          grid: { color: 'rgba(51, 65, 85, 0.5)', drawBorder: false },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10, weight: '500' } }
        }
      },
      animation: { duration: 0 } // completely disable animations to boost speed
    }
  });
}

function updateChartData(value, timestamp) {
  const d = new Date(timestamp);
  const tStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  
  chartDataPoints.push({ label: tStr, value: value });

  // Handle slide window constraints
  const winSelect = document.getElementById('chartWindow').value;
  if (winSelect !== 'all') {
    const limit = parseInt(winSelect) || 100;
    while (chartDataPoints.length > limit) {
      chartDataPoints.shift();
    }
  }

  liveChartInstance.data.labels = chartDataPoints.map(p => p.label);
  liveChartInstance.data.datasets[0].data = chartDataPoints.map(p => p.value);
  
  // Adjust line color dynamically matching DMM active selection
  if (currentDeviceState.func1) {
    const color = MODE_MAP[currentDeviceState.func1]?.color || '#06b6d4';
    liveChartInstance.data.datasets[0].borderColor = color;
    liveChartInstance.data.datasets[0].pointBackgroundColor = color;
  }

  liveChartInstance.update();
}

// SERIAL PORT DROPDOWN POPULATION
function updatePortsDropdown(ports, warning) {
  const select = document.getElementById('portSelect');
  
  // Retain simulator, flush old entries
  select.innerHTML = '<option value="SIMULATOR">-- Simulator --</option>';

  if (warning) {
    appendTerminalLog(`[SERIAL] ${warning}`, 'err');
  }

  if (ports && ports.length > 0) {
    ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.path;
      // Show descriptive labels if available
      opt.text = p.friendlyName ? `${p.path} (${p.friendlyName})` : p.path;
      select.appendChild(opt);
    });
    appendTerminalLog(`[SERIAL] S-au găsit ${ports.length} porturi seriale disponibile.`, 'rx');
  } else {
    console.log('No physical COM ports identified.');
  }
}

// HEADER CONNECTION BADGE MANAGER
function updateConnectionBadge(connected, isSim = true, portName = 'SIMULATOR') {
  const badge = document.getElementById('connectionBadge');
  const badgeText = document.getElementById('connectionBadgeText');
  const connectBtn = document.getElementById('connectBtn');

  if (!connected) {
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-[10px] font-bold text-red-400';
    badgeText.innerText = 'Deconectat';
    connectBtn.innerHTML = '<i data-lucide="play" class="w-3.5 h-3.5"></i> Conectare';
    connectBtn.className = 'bg-cyan-500 hover:bg-cyan-400 text-slate-900 text-[11px] font-bold px-5 py-2 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/20';
  } else if (isSim) {
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-500';
    badgeText.innerText = 'Mod Simulator';
    connectBtn.innerHTML = '<i data-lucide="power" class="w-3.5 h-3.5"></i> Conectare Serială';
    connectBtn.className = 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold px-5 py-2 rounded-xl transition-all flex items-center gap-2';
  } else {
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400';
    badgeText.innerText = `Port Activ: ${portName}`;
    connectBtn.innerHTML = '<i data-lucide="square" class="w-3.5 h-3.5"></i> Deconectare';
    connectBtn.className = 'bg-red-500 hover:bg-red-600 text-white text-[11px] font-bold px-5 py-2 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-red-500/20';
  }
  initializeLucide();
}

// SCPI TERMINAL ACTIONS
function appendTerminalLog(text, type = 'tx') {
  const log = document.getElementById('terminalLog');
  const div = document.createElement('div');
  
  if (type === 'tx') {
    div.className = 'terminal-tx';
    div.innerText = text;
  } else if (type === 'rx') {
    div.className = 'terminal-rx';
    div.innerText = text;
  } else if (type === 'err') {
    div.className = 'terminal-err';
    div.innerText = text;
  }

  log.appendChild(div);
  log.scrollTop = log.scrollHeight; // auto-scroll
}

function handleSCPIResponse(msg) {
  // Output in terminal console
  appendTerminalLog(msg.response, msg.success ? 'rx' : 'err');
}

// TOAST NOTIFICATIONS DRAWER
function showToast(text, type = 'info') {
  // simple native notification toast on bottom left
  const toast = document.createElement('div');
  toast.className = `fixed bottom-8 left-8 z-50 p-4 rounded-2xl shadow-2xl border text-[11px] font-bold flex items-center gap-3 animate-slide-up transition-all cursor-pointer backdrop-blur-md`;
  
  if (type === 'error') {
    toast.className += ' bg-red-500/10 border-red-500/20 text-red-400';
    toast.innerHTML = `<i data-lucide="alert-triangle" class="w-5 h-5 text-red-500"></i> <span>${text}</span>`;
  } else {
    toast.className += ' bg-cyan-500/10 border-cyan-500/20 text-cyan-400';
    toast.innerHTML = `<i data-lucide="info" class="w-5 h-5 text-cyan-500"></i> <span>${text}</span>`;
  }

  document.body.appendChild(toast);
  initializeLucide();
  
  toast.onclick = () => toast.remove();
  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// SETUP DOM EVENT HANDLERS
function setupUIEventListeners() {
  
  // 1. Connection connect toggle click
  document.getElementById('connectBtn').onclick = () => {
    const selectedPort = document.getElementById('portSelect').value;
    const selectedBaud = document.getElementById('baudSelect').value;

    if (currentDeviceState.connected && !currentDeviceState.isSimulator) {
      // Disconnect and switch back to simulator
      socket.send(JSON.stringify({ type: 'disconnect_serial' }));
    } else {
      if (selectedPort === 'SIMULATOR') {
        // Fall back or force Simulator
        socket.send(JSON.stringify({ type: 'toggle_simulator', enable: true }));
        showToast('Mod Simulator activat cu succes!', 'info');
      } else {
        // Connect actual serial
        appendTerminalLog(`Trimit comandă conectare port ${selectedPort}...`, 'tx');
        socket.send(JSON.stringify({
          type: 'connect_serial',
          path: selectedPort,
          baudRate: selectedBaud
        }));
      }
    }
  };

  // 2. Port dropdown clicks -> scans ports
  document.getElementById('portSelect').onfocus = () => {
    socket.send(JSON.stringify({ type: 'scan_ports' }));
  };

  // 3. Grid Selector functions
  document.querySelectorAll('#funcGrid button').forEach(btn => {
    btn.onclick = () => {
      const targetFunc = btn.getAttribute('data-func');
      socket.send(JSON.stringify({ type: 'set_function', func: targetFunc }));
      playSynthesizedBeep(1800, 40); // tactile UI feedback beep
    };
  });

  // 4. Beeper toggle
  document.getElementById('beeperStateToggle').onchange = (e) => {
    socket.send(JSON.stringify({ type: 'set_beeper', enable: e.target.checked }));
  };

  // 5. Speed rating clicks
  document.getElementById('speedF').onclick = () => socket.send(JSON.stringify({ type: 'set_speed', speed: 'F' }));
  document.getElementById('speedM').onclick = () => socket.send(JSON.stringify({ type: 'set_speed', speed: 'M' }));
  document.getElementById('speedL').onclick = () => socket.send(JSON.stringify({ type: 'set_speed', speed: 'L' }));

  // 6. Range manual configs
  document.getElementById('rangeSelect').onchange = (e) => {
    socket.send(JSON.stringify({ type: 'set_range', range: e.target.value }));
  };

  document.getElementById('rangeAutoToggle').onchange = (e) => {
    if (e.target.checked) {
      socket.send(JSON.stringify({ type: 'set_range', range: 'AUTO' }));
    } else {
      const mapping = MODE_MAP[currentDeviceState.func1];
      if (mapping && mapping.ranges.length > 0) {
        socket.send(JSON.stringify({ type: 'set_range', range: mapping.ranges[0].val }));
      }
    }
  };

  // 7. Extra buttons
  document.getElementById('toggleSubDisplayBtn').onclick = () => {
    const nextSub = currentDeviceState.func2 === 'NONE' ? 'FREQ' : 'NONE';
    socket.send(JSON.stringify({ type: 'toggle_sub_display', subFunc: nextSub }));
  };

  document.getElementById('beepHardwareBtn').onclick = () => {
    socket.send(JSON.stringify({ type: 'trigger_hardware_beep' }));
  };

  // 8. Sampling slider changer
  const intervalSlider = document.getElementById('sampleIntervalSlider');
  const intervalText = document.getElementById('sampleIntervalText');
  
  intervalSlider.oninput = (e) => {
    const ms = e.target.value;
    intervalText.innerText = `${ms} ms`;
  };

  intervalSlider.onchange = (e) => {
    const ms = e.target.value;
    socket.send(JSON.stringify({ type: 'set_poll_interval', intervalMs: ms }));
  };

  // 9. Data logging actions
  document.getElementById('pauseLogBtn').onclick = () => {
    isLoggingPaused = !isLoggingPaused;
    document.getElementById('pauseLogIcon').setAttribute('data-lucide', isLoggingPaused ? 'play' : 'pause');
    document.getElementById('pauseLogBtn').innerHTML = isLoggingPaused ? 
      '<i data-lucide="play" class="w-3 h-3 text-cyber-neonGreen"></i><span>Continuă Log</span>' : 
      '<i data-lucide="pause" class="w-3 h-3 text-cyan-400"></i><span>Pauză Log</span>';
    initializeLucide();
    showToast(isLoggingPaused ? 'Logare date suspendată.' : 'Logare date repornită.', 'info');
  };

  document.getElementById('clearLogsBtn').onclick = () => {
    if (confirm('Sigur doriți să ștergeți toate înregistrările logate?')) {
      readingsLog = [];
      stats = { min: null, max: null, sum: 0, sqSum: 0, count: 0, avg: 0 };
      updateStatsDisplay();
      document.getElementById('logTableBody').innerHTML = `
        <tr id="emptyLogPlaceholder">
          <td colspan="4" class="p-4 text-center text-gray-500">Niciun eșantion stocat... Conectează aparatul pentru a începe logarea.</td>
        </tr>
      `;
      document.getElementById('logCount').innerText = '0 recs';
      showToast('Log stocat golit!', 'info');
    }
  };

  // 10. Exports functions
  document.getElementById('exportCsvBtn').onclick = () => {
    if (readingsLog.length === 0) {
      showToast('Nu există înregistrări pentru export!', 'error');
      return;
    }
    exportToCSV();
  };

  document.getElementById('exportJsonBtn').onclick = () => {
    if (readingsLog.length === 0) {
      showToast('Nu există înregistrări pentru export!', 'error');
      return;
    }
    exportToJSON();
  };

  // 11. Chart panel controls
  document.getElementById('pauseChartBtn').onclick = () => {
    isChartPaused = !isChartPaused;
    document.getElementById('pauseChartIcon').setAttribute('data-lucide', isChartPaused ? 'play' : 'pause');
    document.getElementById('pauseChartBtn').className = isChartPaused ? 'bg-cyber-border hover:bg-cyber-card border border-cyan-500 text-cyan-400 rounded-lg p-1.5 transition-all' : 'bg-cyber-darker hover:bg-cyber-border border border-cyber-border rounded-lg p-1.5 text-gray-300 transition-all';
    initializeLucide();
    showToast(isChartPaused ? 'Reprezentarea pe grafic a fost întreruptă.' : 'Reprezentarea repornită.', 'info');
  };

  document.getElementById('clearChartBtn').onclick = () => {
    chartDataPoints = [];
    liveChartInstance.data.labels = [];
    liveChartInstance.data.datasets[0].data = [];
    liveChartInstance.update();
    showToast('Grafic golit!', 'info');
  };

  // 12. SCPI command form submissions
  document.getElementById('scpiForm').onsubmit = (e) => {
    e.preventDefault();
    const inp = document.getElementById('scpiInput');
    const cmd = inp.value.trim();
    if (!cmd) return;

    appendTerminalLog(cmd, 'tx');
    socket.send(JSON.stringify({ type: 'send_scpi', command: cmd }));
    inp.value = '';
  };

  // 13. Terminal Quick suggestions pills click
  document.querySelectorAll('#quickScpiPills button').forEach(p => {
    p.onclick = () => {
      const cmd = p.getAttribute('data-cmd');
      appendTerminalLog(cmd, 'tx');
      socket.send(JSON.stringify({ type: 'send_scpi', command: cmd }));
    };
  });
}

// CSV FORMAT DOWNLOADING AGENT
function exportToCSV() {
  let csvContent = 'data:text/csv;charset=utf-8,';
  csvContent += 'Index,Timestamp,Hour,RawValue,PrefixValue,Unit,Mode,Status\r\n';

  readingsLog.forEach(row => {
    const rStr = `${row.index},${row.timestamp},"${row.formattedTime}",${row.value || ''},"${row.raw || ''}","${row.unit || ''}","${row.mode}","${row.status}"`;
    csvContent += rStr + '\r\n';
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `owon_log_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// JSON FORMAT DOWNLOADING AGENT
function exportToJSON() {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(readingsLog, null, 2));
  const link = document.createElement('a');
  link.setAttribute('href', dataStr);
  link.setAttribute('download', `owon_log_${Date.now()}.json`);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// RE-TRIGGER VECTOR SVG ICONS GRAPHICS VIA CDN
function initializeLucide() {
  try {
    lucide.createIcons();
  } catch (err) {
    console.warn('Eroare la redarea iconițelor Lucide:', err);
  }
}
