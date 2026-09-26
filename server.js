const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Dynamically import serialport to avoid C++ compiler errors if the environment lacks serial build tools.
// If serialport fails to load, we fall back gracefully to Simulator-only mode.
let SerialPort = null;
let ReadlineParser = null;
try {
  const serialportPkg = require('serialport');
  SerialPort = serialportPkg.SerialPort;
  const parserPkg = require('@serialport/parser-readline');
  ReadlineParser = parserPkg.ReadlineParser;
  console.log('[SERIAL] SerialPort package loaded successfully.');
} catch (err) {
  console.warn('[SERIAL WARNING] Could not load serialport package. Server will run in Simulator Mode only.');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint to scan serial ports
app.get('/api/ports', async (req, res) => {
  try {
    if (!SerialPort) {
      return res.json({ success: true, ports: [], warning: 'SerialPort library not available. Running in simulation mode.' });
    }
    const ports = await SerialPort.list();
    return res.json({ success: true, ports });
  } catch (err) {
    console.error('[API ERROR] Error listing serial ports:', err);
    return res.json({ success: false, error: err.message, ports: [] });
  }
});

// MULTIMETER STATE & SIMULATOR DATABASE
let activePort = null;
let activeParser = null;
let queryInterval = null;
let querySpeedMs = 500; // default query every 500ms
let isQuerying = false;
let queryCycle = 0; // rotation counter for real-time state synchronization

const validModes = {
  'VOLT': 'VOLT', 'VOLT DC': 'VOLT', 'VOLT:DC': 'VOLT',
  'VOLT AC': 'VOLT AC', 'VOLT:AC': 'VOLT AC',
  'CURR': 'CURR', 'CURR DC': 'CURR', 'CURR:DC': 'CURR',
  'CURR AC': 'CURR AC', 'CURR:AC': 'CURR AC',
  'RES': 'RES', 'RESISTANCE': 'RES',
  'FRES': 'FRES', 'FRESISTANCE': 'FRES',
  'CAP': 'CAP', 'CAPACITANCE': 'CAP',
  'FREQ': 'FREQ', 'FREQUENCY': 'FREQ',
  'PER': 'PER', 'PERIOD': 'PER',
  'TEMP': 'TEMP', 'TEMPERATURE': 'TEMP',
  'DIOD': 'DIOD', 'DIODE': 'DIOD',
  'CONT': 'CONT', 'CONTINUITY': 'CONT'
};

const FUNCTION_TO_CONF_MAP = {
  'VOLT': 'CONF:VOLT:DC',
  'VOLT AC': 'CONF:VOLT:AC',
  'CURR': 'CONF:CURR:DC',
  'CURR AC': 'CONF:CURR:AC',
  'RES': 'CONF:RES',
  'FRES': 'CONF:FRES',
  'CAP': 'CONF:CAP',
  'FREQ': 'CONF:FREQ',
  'PER': 'CONF:PER',
  'TEMP': 'CONF:TEMP:RTD',
  'DIOD': 'CONF:DIOD',
  'CONT': 'CONF:CONT'
};

// Hardware State (both actual DMM and Simulator)
const deviceState = {
  connected: false,
  isSimulator: false,
  portName: 'NOT CONNECTED',
  baudRate: 115200,
  idn: 'OWON,XDM2041',
  func1: 'VOLT',      
  func2: 'NONE',      
  range: 'AUTO',      
  speed: 'M',         
  beeper: 'ON',       
  relative: null,     
  remoteMode: false,   
};

// SIMULATOR VALUES GENERATOR (Creates realistic scientific outputs)
let simulatorTime = 0;
function getSimulatedReading() {
  simulatorTime += (querySpeedMs / 1000);
  const t = simulatorTime;
  const noise = (Math.random() - 0.5) * 0.0005; // tiny noise

  switch (deviceState.func1) {
    case 'VOLT': // DC Voltage: simulate a slowly discharging 5V lithium battery with minor fluctuations
      const baseV = 4.1523;
      const discharge = -0.0002 * t;
      const ripple = 0.0012 * Math.sin(t * 0.1);
      const finalV = baseV + discharge + ripple + (noise * 0.1);
      return finalV.toExponential(4);

    case 'VOLT AC': // AC Voltage: simulate 230V mains with slight grid frequency/voltage fluctuation
      const baseVac = 230.15;
      const fluctuation = 0.45 * Math.sin(t * 0.05) + 0.15 * Math.sin(t * 0.8);
      const finalVac = baseVac + fluctuation + (noise * 50);
      return finalVac.toExponential(4);

    case 'CURR': // DC Current: simulate a small circuit drawing 45.2mA with occasional step changes
      const baseIdc = 0.04523;
      const step = Math.floor(t / 15) % 2 === 0 ? 0.005 : 0;
      const finalIdc = baseIdc + step + (noise * 0.01);
      return finalIdc.toExponential(4);

    case 'CURR AC': // AC Current: simulate an AC motor drawing about 1.25A with a slight load variance
      const baseIac = 1.245;
      const motorFluct = 0.012 * Math.sin(t * 0.2);
      const finalIac = baseIac + motorFluct + (noise * 0.5);
      return finalIac.toExponential(4);

    case 'RES': // Resistance: simulate a 10k Ohm thermistor reacting to ambient heat (gradual drift)
      const baseR = 10000.0;
      const drift = -1.2 * t; // heating up slightly, resistance goes down
      const finalR = baseR + drift + (noise * 100);
      return finalR.toExponential(4);

    case 'FRES': // 4-wire resistance: highly stable 50 Ohm precision resistor
      const baseFres = 50.0024;
      const finalFres = baseFres + (noise * 0.1);
      return finalFres.toExponential(4);

    case 'CAP': // Capacitance: simulate measuring a 47uF electrolytic capacitor
      const baseC = 47.35e-6;
      const finalC = baseC + (noise * 1e-8);
      return finalC.toExponential(9);

    case 'FREQ': // Frequency: simulate 50.02 Hz mains frequency tracking
      const baseF = 50.0192;
      const fDrift = 0.015 * Math.sin(t * 0.02) + 0.003 * Math.sin(t * 0.5);
      const finalF = baseF + fDrift + (noise * 0.01);
      return finalF.toExponential(4);

    case 'PER': // Period: reciprocal of frequency (1 / 50 Hz = 0.02 s)
      const fVal = 50.0192 + 0.015 * Math.sin(t * 0.02);
      const finalP = 1.0 / fVal;
      return finalP.toExponential(6);

    case 'TEMP': // Temperature: simulate room temperature at 23.4 °C with slow air conditioning cycles
      const baseTemp = 23.45;
      const acCycle = 0.8 * Math.sin(t * 0.01);
      const finalTemp = baseTemp + acCycle + (noise * 20);
      return finalTemp.toExponential(2);

    case 'DIOD': // Diode: Forward drop of silicon diode ~ 0.612 V
      const baseD = 0.6124;
      const finalD = baseD + (noise * 0.1);
      return finalD.toExponential(4);

    case 'CONT': // Continuity: alternating between short circuit (0.2 ohm) and open circuit (OL) every 8s
      const isShort = Math.floor(t / 8) % 2 === 0;
      if (isShort) {
        return (0.18 + Math.random() * 0.04).toExponential(4); // short! Beeper should beep!
      } else {
        return '9.9000E+37'; // Overload / Open circuit!
      }

    default:
      return '0.0000E+00';
  }
}

// Sub display simulation value (typically frequency if measuring AC Voltage or AC Current)
function getSimulatedSubReading() {
  if (deviceState.func2 === 'NONE') return 'NONe';
  if (deviceState.func2 === 'FREQ') {
    const baseF = 50.0192 + 0.015 * Math.sin(simulatorTime * 0.02);
    return baseF.toExponential(4);
  }
  return '0.0000E+00';
}

// SCPI SIMULATOR PARSER
// This allows the SCPI console to work exactly like the physical unit
function processSimulatedSCPI(command) {
  const cmd = command.trim().toUpperCase();
  console.log(`[SIMULATOR IN] "${cmd}"`);

  // Identity query
  if (cmd === '*IDN?') {
    return deviceState.idn;
  }
  
  // Reset command
  if (cmd === '*RST') {
    deviceState.func1 = 'VOLT';
    deviceState.func2 = 'NONE';
    deviceState.range = 'AUTO';
    deviceState.speed = 'M';
    deviceState.beeper = 'ON';
    deviceState.relative = null;
    return null; // No output for reset
  }

  // Measure Query (Dual display returns both, single returns one)
  if (cmd === 'MEAS?' || cmd === 'MEAS1?') {
    const mainVal = getSimulatedReading();
    if (cmd === 'MEAS?' && deviceState.func2 !== 'NONE') {
      const subVal = getSimulatedSubReading();
      return `${mainVal},${subVal}`;
    }
    return mainVal;
  }

  if (cmd === 'MEAS2?') {
    return getSimulatedSubReading();
  }

  // Function selection & query
  if (cmd.startsWith('FUNC1 ') || cmd.startsWith('FUNCTION1 ') || cmd.startsWith('FUNC ') || cmd.startsWith('FUNCTION ')) {
    const cleanCmd = cmd.replace('FUNCTION1', '').replace('FUNC1', '').replace('FUNCTION', '').replace('FUNC', '').trim();
    // remove quotes if present
    const funcStr = cleanCmd.replace(/['"]/g, '').trim();
    
    const validModes = {
      'VOLT': 'VOLT', 'VOLT DC': 'VOLT', 'VOLT:DC': 'VOLT',
      'VOLT AC': 'VOLT AC', 'VOLT:AC': 'VOLT AC',
      'CURR': 'CURR', 'CURR DC': 'CURR', 'CURR:DC': 'CURR',
      'CURR AC': 'CURR AC', 'CURR:AC': 'CURR AC',
      'RES': 'RES', 'RESISTANCE': 'RES',
      'FRES': 'FRES', 'FRESISTANCE': 'FRES',
      'CAP': 'CAP', 'CAPACITANCE': 'CAP',
      'FREQ': 'FREQ', 'FREQUENCY': 'FREQ',
      'PER': 'PER', 'PERIOD': 'PER',
      'TEMP': 'TEMP', 'TEMPERATURE': 'TEMP',
      'DIOD': 'DIOD', 'DIODE': 'DIOD',
      'CONT': 'CONT', 'CONTINUITY': 'CONT'
    };

    if (validModes[funcStr] !== undefined) {
      deviceState.func1 = validModes[funcStr];
      console.log(`[SIMULATOR] Changed function 1 to: ${deviceState.func1}`);
      broadcastDeviceState();
    }
    return null;
  }

  if (cmd === 'FUNC1?' || cmd === 'FUNCTION1?' || cmd === 'FUNC?' || cmd === 'FUNCTION?') {
    // return format is quoted string like "VOLT" or "VOLT AC"
    return `"${deviceState.func1}"`;
  }

  // Sub display selection
  if (cmd.startsWith('FUNC2 ') || cmd.startsWith('FUNCTION2 ')) {
    const subStr = cmd.replace('FUNCTION2', '').replace('FUNC2', '').replace(/['"]/g, '').trim();
    if (subStr === 'FREQ' || subStr === 'FREQUENCY') {
      deviceState.func2 = 'FREQ';
    } else if (subStr === 'NONE') {
      deviceState.func2 = 'NONE';
    }
    console.log(`[SIMULATOR] Changed function 2 to: ${deviceState.func2}`);
    broadcastDeviceState();
    return null;
  }

  if (cmd === 'FUNC2?' || cmd === 'FUNCTION2?') {
    return `"${deviceState.func2}"`;
  }

  // Beeper commands
  if (cmd === 'SYST:BEEP:STAT ON' || cmd === 'SYSTEM:BEEPER:STATE ON') {
    deviceState.beeper = 'ON';
    broadcastDeviceState();
    return null;
  }
  if (cmd === 'SYST:BEEP:STAT OFF' || cmd === 'SYSTEM:BEEPER:STATE OFF') {
    deviceState.beeper = 'OFF';
    broadcastDeviceState();
    return null;
  }
  if (cmd === 'SYST:BEEP:STAT?' || cmd === 'SYSTEM:BEEPER:STATE?') {
    return deviceState.beeper === 'ON' ? '1' : '0';
  }
  // Standard beep triggers an immediate acoustic beep in client UI
  if (cmd === 'SYST:BEEP' || cmd === 'SYSTEM:BEEPER' || cmd === 'SYSTEM:BEEP') {
    broadcastToAll({ type: 'trigger_local_beep' });
    return null;
  }

  // Autoscale / manual range
  if (cmd === 'AUTO' || cmd === 'AUTO ON') {
    deviceState.range = 'AUTO';
    broadcastDeviceState();
    return null;
  }
  if (cmd === 'AUTO OFF') {
    deviceState.range = 'MANUAL';
    broadcastDeviceState();
    return null;
  }
  if (cmd === 'AUTO?') {
    return deviceState.range === 'AUTO' ? '1' : '0';
  }

  if (cmd.startsWith('RANGE ')) {
    const rng = cmd.replace('RANGE', '').trim();
    deviceState.range = rng; // Set manual range representation
    broadcastDeviceState();
    return null;
  }

  // Speed rate
  if (cmd.startsWith('RATE ')) {
    const spd = cmd.replace('RATE', '').trim();
    if (['F', 'M', 'L', 'HIGH', 'MIDDLE', 'LOW'].includes(spd)) {
      deviceState.speed = spd[0]; // takes F, M, L
      broadcastDeviceState();
    }
    return null;
  }
  if (cmd === 'RATE?') {
    return deviceState.speed;
  }

  // Local / Remote
  if (cmd === 'SYST:REM' || cmd === 'SYSTEM:REMOTE') {
    deviceState.remoteMode = true;
    broadcastDeviceState();
    return null;
  }
  if (cmd === 'SYST:LOC' || cmd === 'SYSTEM:LOCAL') {
    deviceState.remoteMode = false;
    broadcastDeviceState();
    return null;
  }

  // Date and Time
  if (cmd === 'SYST:DATE?') {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (cmd === 'SYST:TIME?') {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  // Fallback for unrecognized command
  console.log(`[SIMULATOR] Unknown/Unhandled SCPI: ${cmd}`);
  return 'ERR: UNKNOWN COMMAND';
}

// REAL HARDWARE SERIAL COMMUNICATIONS
// Commands ending with '?' are queries that wait for a response line from the device.
// Commands without '?' are configuration commands (write-only) that do NOT return a response line.
let pendingCommandCallback = null;
const commandQueue = [];
let isWritingToPort = false;

function processNextQueueItem() {
  if (isWritingToPort || commandQueue.length === 0 || pendingCommandCallback !== null) return;
  
  const item = commandQueue.shift();
  if (!activePort || !activePort.writable) {
    item.reject(new Error('Portul serial nu este disponibil sau a fost deconectat'));
    return;
  }

  const isQuery = item.cmd.trim().endsWith('?');

  if (isQuery) {
    pendingCommandCallback = { resolve: item.resolve, reject: item.reject, cmd: item.cmd };
    console.log(`[SERIAL QUERY] "${item.cmd}"`);
    activePort.write(item.cmd + '\n', (err) => {
      if (err) {
        console.error('[SERIAL WRITE ERROR]', err);
        pendingCommandCallback = null;
        item.reject(err);
        processNextQueueItem();
      }
    });
  } else {
    isWritingToPort = true;
    console.log(`[SERIAL CMD] "${item.cmd}"`);
    activePort.write(item.cmd + '\n', (err) => {
      if (err) {
        console.error('[SERIAL WRITE ERROR]', err);
        isWritingToPort = false;
        item.reject(err);
        processNextQueueItem();
      } else {
        // Allow instrument 40ms to process the configuration command before executing next
        setTimeout(() => {
          isWritingToPort = false;
          item.resolve('(sent)');
          processNextQueueItem();
        }, 40);
      }
    });
  }
}

function sendSCPICommand(cmd) {
  return new Promise((resolve, reject) => {
    const isQuery = cmd.trim().endsWith('?');
    let timeout = null;

    if (isQuery) {
      timeout = setTimeout(() => {
        const idx = commandQueue.findIndex(item => item.cmd === cmd);
        if (idx !== -1) commandQueue.splice(idx, 1);
        
        if (pendingCommandCallback && pendingCommandCallback.cmd === cmd) {
          pendingCommandCallback = null;
        }
        
        console.error(`[SERIAL TIMEOUT] Niciun răspuns pentru query-ul: "${cmd}" în 2s`);
        reject(new Error(`Timeout la comanda: ${cmd}`));
        processNextQueueItem();
      }, 2000);
    }

    commandQueue.push({ 
      cmd, 
      resolve: (data) => { if (timeout) clearTimeout(timeout); resolve(data); }, 
      reject: (err) => { if (timeout) clearTimeout(timeout); reject(err); } 
    });
    processNextQueueItem();
  });
}

// Handle incoming lines from real serial port
function handleSerialLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  console.log(`[SERIAL IN] "${trimmed}"`);

  if (pendingCommandCallback) {
    const cb = pendingCommandCallback;
    pendingCommandCallback = null;
    cb.resolve(trimmed);
  } else {
    // Unsolicited data
    broadcastToAll({ type: 'serial_unsolicited', data: trimmed });
  }
  
  processNextQueueItem();
}

// WEBSOCKET BROADCAST UTILS
function broadcastToAll(messageObj) {
  const jsonStr = JSON.stringify(messageObj);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonStr);
    }
  });
}

function broadcastDeviceState() {
  broadcastToAll({
    type: 'state_update',
    state: deviceState
  });
}

// WEBSOCKET COMMUNICATION MAIN ROUTER
wss.on('connection', (ws) => {
  console.log('[WS] Client connected.');
  
  // Send current state immediately upon connection
  ws.send(JSON.stringify({
    type: 'state_update',
    state: deviceState
  }));

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      console.log(`[WS MESSAGE IN] Type: ${msg.type}`);

      switch (msg.type) {
        // Toggle simulator mode
        case 'toggle_simulator':
          const enableSim = !!msg.enable;
          if (!enableSim && !activePort) {
            ws.send(JSON.stringify({ type: 'error', message: 'Nu se poate opri simulatorul fără o conexiune serială activă!' }));
            return;
          }
          deviceState.isSimulator = enableSim;
          if (enableSim) {
            // Disconnect physical serial port if active
            closeSerialPort();
            deviceState.connected = true;
            deviceState.portName = 'SIMULATOR';
            deviceState.idn = 'OWON,XDM2041,SIM20260919,V1.2.0,3';
          }
          broadcastDeviceState();
          restartQueryInterval();
          break;

        // Scan serial ports
        case 'scan_ports':
          if (SerialPort) {
            const list = await SerialPort.list();
            ws.send(JSON.stringify({ type: 'ports_list', ports: list }));
          } else {
            ws.send(JSON.stringify({ type: 'ports_list', ports: [], warning: 'SerialPort lib missing' }));
          }
          break;

        // Connect to a COM port
        case 'connect_serial':
          const { path: comPath, baudRate } = msg;
          if (!comPath) {
            ws.send(JSON.stringify({ type: 'error', message: 'Numele portului serial lipsește!' }));
            return;
          }
          if (!SerialPort) {
            ws.send(JSON.stringify({ type: 'error', message: 'Librăria serialport nu este disponibilă pe server.' }));
            return;
          }

          try {
            console.log(`[SERIAL] Attempting connection to ${comPath} at ${baudRate || 115200}`);
            closeSerialPort(); // Close any old connection

            activePort = new SerialPort({
              path: comPath,
              baudRate: parseInt(baudRate) || 115200,
              dataBits: 8,
              parity: 'none',
              stopBits: 1,
              autoOpen: false
            });

            activeParser = activePort.pipe(new ReadlineParser({ delimiter: '\n' }));
            activeParser.on('data', (data) => {
              handleSerialLine(data);
            });

            activePort.open(async (err) => {
              if (err) {
                console.error(`[SERIAL CONNECT FAIL] ${comPath}:`, err.message);
                ws.send(JSON.stringify({ type: 'error', message: `Eroare conexiune port ${comPath}: ${err.message}` }));
                return;
              }

              console.log(`[SERIAL CONNECT SUCCESS] Connected to ${comPath}`);
              deviceState.connected = true;
              deviceState.isSimulator = false;
              deviceState.portName = comPath;
              deviceState.baudRate = baudRate;
              
              // Broadcast connection success immediately
              broadcastDeviceState();

              // Query device identity & setup before starting continuous polling
              try {
                await new Promise(r => setTimeout(r, 400));
                await sendSCPICommand('SYST:REM'); // Enter Remote SCPI mode
                await new Promise(r => setTimeout(r, 100));

                const idnResult = await sendSCPICommand('*IDN?');
                if (idnResult) deviceState.idn = idnResult;
                
                const funcRes = await sendSCPICommand('FUNC1?');
                if (funcRes) {
                  const cleanF = funcRes.replace(/['"]/g, '').trim().toUpperCase();
                  if (validModes[cleanF]) deviceState.func1 = validModes[cleanF];
                }

                const rngRes = await sendSCPICommand('AUTO?');
                if (rngRes) deviceState.range = (rngRes.trim() === '1') ? 'AUTO' : 'MANUAL';

                const rateRes = await sendSCPICommand('RATE?');
                if (rateRes && rateRes.trim()) deviceState.speed = rateRes.trim()[0];

                broadcastDeviceState();
                ws.send(JSON.stringify({ type: 'notification', text: `Conectat la instrument! ID: ${deviceState.idn}` }));
              } catch (subErr) {
                console.warn('[SERIAL INIT WARNING] Failed querying device initial state:', subErr.message);
              } finally {
                restartQueryInterval();
              }
            });

            activePort.on('close', () => {
              console.log('[SERIAL CLOSED] Port was closed.');
              handlePortUnexpectedDisconnect();
            });

            activePort.on('error', (err) => {
              console.error('[SERIAL RUNTIME ERROR]', err);
              ws.send(JSON.stringify({ type: 'error', message: `Eroare port serial: ${err.message}` }));
            });

          } catch (serialErr) {
            console.error('[SERIAL ERROR IN CONNECT]', serialErr);
            ws.send(JSON.stringify({ type: 'error', message: `Eroare deschidere port: ${serialErr.message}` }));
          }
          break;

        // Disconnect serial port (go back to Simulator Mode)
        case 'disconnect_serial':
          console.log('[SERIAL] Client requested manual disconnect. Falling back to simulator.');
          try {
            await sendSCPICommand('SYST:LOC'); // Release multimeter back to local front panel control
          } catch (e) {}
          closeSerialPort();
          deviceState.connected = true;
          deviceState.isSimulator = true;
          deviceState.portName = 'SIMULATOR';
          deviceState.idn = 'OWON,XDM2041,SIM20260919,V1.2.0,3';
          broadcastDeviceState();
          restartQueryInterval();
          ws.send(JSON.stringify({ type: 'notification', text: 'Port deconectat. Aparatul a revenit pe control local (LOCAL).' }));
          break;

        // Send a custom SCPI command from the terminal
        case 'send_scpi':
          const rawCmd = msg.command;
          if (!rawCmd) return;

          const logId = msg.logId || Math.random().toString(36).substring(7);

          if (deviceState.isSimulator) {
            // Simulated SCPI Execution
            const response = processSimulatedSCPI(rawCmd);
            ws.send(JSON.stringify({
              type: 'scpi_response',
              logId,
              command: rawCmd,
              response: response === null ? '(executat)' : response,
              success: true
            }));
          } else {
            // Real Hardware SCPI Execution
            try {
              const response = await sendSCPICommand(rawCmd);
              ws.send(JSON.stringify({
                type: 'scpi_response',
                logId,
                command: rawCmd,
                response: response === '(sent)' ? '(comandă executată)' : response,
                success: true
              }));
              
              // Post-process some state variables based on commands typed in terminal
              syncStateFromRawCommand(rawCmd, response);
            } catch (err) {
              ws.send(JSON.stringify({
                type: 'scpi_response',
                logId,
                command: rawCmd,
                response: `Error: ${err.message}`,
                success: false
              }));
            }
          }
          break;

        // Update poll interval speed (ms)
        case 'set_poll_interval':
          const ms = parseInt(msg.intervalMs);
          if (ms >= 100 && ms <= 10000) {
            querySpeedMs = ms;
            console.log(`[WS] Poll interval updated to ${querySpeedMs}ms`);
            restartQueryInterval();
            ws.send(JSON.stringify({ type: 'notification', text: `Interval de citire actualizat la ${querySpeedMs}ms` }));
          }
          break;

        // Quick set function via UI button
        case 'set_function':
          const targetFunc = msg.func; // e.g. "VOLT", "VOLT AC", etc.
          if (!targetFunc) return;
          console.log(`[WS] Quick UI set function: ${targetFunc}`);

          if (deviceState.isSimulator) {
            processSimulatedSCPI(`FUNC1 "${targetFunc}"`);
          } else {
            try {
              const confCmd = FUNCTION_TO_CONF_MAP[targetFunc];
              if (!confCmd) throw new Error(`Funcție necunoscută: ${targetFunc}`);
              
              await sendSCPICommand(confCmd);
              deviceState.func1 = targetFunc;
              broadcastDeviceState();
            } catch (err) {
              ws.send(JSON.stringify({ type: 'error', message: `Eroare setare funcție: ${err.message}` }));
            }
          }
          break;

        // Toggle sub display function via UI
        case 'toggle_sub_display':
          const targetSub = msg.subFunc; // "FREQ" or "NONE"
          if (!targetSub) return;
          console.log(`[WS] Quick UI set sub display: ${targetSub}`);

          if (deviceState.isSimulator) {
            processSimulatedSCPI(`FUNC2 "${targetSub}"`);
          } else {
            try {
              await sendSCPICommand(`FUNC2 "${targetSub}"`);
              deviceState.func2 = targetSub;
              broadcastDeviceState();
            } catch (err) {
              ws.send(JSON.stringify({ type: 'error', message: `Eroare setare display secundar: ${err.message}` }));
            }
          }
          break;

        // Change Range setting
        case 'set_range':
          const targetRange = msg.range; // "AUTO" or specific index
          if (!targetRange) return;

          if (deviceState.isSimulator) {
            if (targetRange === 'AUTO') {
              processSimulatedSCPI('AUTO ON');
            } else {
              processSimulatedSCPI(`RANGE ${targetRange}`);
            }
          } else {
            try {
              if (targetRange === 'AUTO') {
                await sendSCPICommand('AUTO ON');
                deviceState.range = 'AUTO';
              } else {
                await sendSCPICommand(`RANGE ${targetRange}`);
                deviceState.range = targetRange;
              }
              broadcastDeviceState();
            } catch (err) {
              ws.send(JSON.stringify({ type: 'error', message: `Eroare schimbare scală/range: ${err.message}` }));
            }
          }
          break;

        // Change Speed setting
        case 'set_speed':
          const targetSpeed = msg.speed; // "F", "M", "L"
          if (!targetSpeed) return;

          if (deviceState.isSimulator) {
            processSimulatedSCPI(`RATE ${targetSpeed}`);
          } else {
            try {
              await sendSCPICommand(`RATE ${targetSpeed}`);
              deviceState.speed = targetSpeed;
              broadcastDeviceState();
            } catch (err) {
              ws.send(JSON.stringify({ type: 'error', message: `Eroare schimbare viteză: ${err.message}` }));
            }
          }
          break;

        // Toggle device Beeper
        case 'set_beeper':
          const beeperOn = !!msg.enable;
          const beepCmd = beeperOn ? 'SYST:BEEP:STAT ON' : 'SYST:BEEP:STAT OFF';

          if (deviceState.isSimulator) {
            processSimulatedSCPI(beepCmd);
          } else {
            try {
              await sendSCPICommand(beepCmd);
              deviceState.beeper = beeperOn ? 'ON' : 'OFF';
              broadcastDeviceState();
            } catch (err) {
              ws.send(JSON.stringify({ type: 'error', message: `Eroare configurare beeper: ${err.message}` }));
            }
          }
          break;

        // Trigger local physical beep
        case 'trigger_hardware_beep':
          if (deviceState.isSimulator) {
            processSimulatedSCPI('SYST:BEEP');
          } else {
            try {
              await sendSCPICommand('SYST:BEEP');
            } catch (err) {
              console.error('Failed to beep hardware:', err.message);
            }
          }
          break;

        default:
          console.warn('[WS] Unhandled WebSocket message type:', msg.type);
      }
    } catch (e) {
      console.error('[WS ERROR] Failed parsing JSON socket message:', e);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected.');
  });
});

// CLOSE SERIAL PORT GENTLY
function closeSerialPort() {
  if (activePort) {
    try {
      activePort.close();
      console.log('[SERIAL] Port closed successfully.');
    } catch (e) {
      console.error('[SERIAL] Error closing port:', e.message);
    }
    activePort = null;
    activeParser = null;
  }
}

// HANDLE UNEXPECTED SERIAL DISCONNECTION
function handlePortUnexpectedDisconnect() {
  console.warn('[SERIAL WARNING] Unexpected serial port close event!');
  activePort = null;
  activeParser = null;

  // Fall back immediately to simulator mode
  deviceState.connected = true;
  deviceState.isSimulator = true;
  deviceState.portName = 'SIMULATOR';
  deviceState.idn = 'OWON,XDM2041,SIM20260919,V1.2.0,3';

  broadcastDeviceState();
  restartQueryInterval();
  broadcastToAll({
    type: 'error',
    message: 'Portul serial s-a deconectat inopinat! Serverul a trecut automat pe modul Simulator.'
  });
}

// SYNC STATE VALUES FROM RAW TERMINAL WRITES
function syncStateFromRawCommand(rawCmd, response) {
  const cmd = rawCmd.trim().toUpperCase();
  try {
    if (cmd.startsWith('FUNC1 ') || cmd.startsWith('FUNC ')) {
      const parts = cmd.split('"');
      if (parts.length >= 2) deviceState.func1 = parts[1];
    } else if (cmd.startsWith('FUNC2 ')) {
      const parts = cmd.split('"');
      if (parts.length >= 2) deviceState.func2 = parts[1];
    } else if (cmd === 'AUTO ON' || cmd === 'AUTO') {
      deviceState.range = 'AUTO';
    } else if (cmd === 'AUTO OFF') {
      deviceState.range = 'MANUAL';
    } else if (cmd.startsWith('RANGE ')) {
      deviceState.range = cmd.replace('RANGE', '').trim();
    } else if (cmd.startsWith('RATE ')) {
      deviceState.speed = cmd.replace('RATE', '').trim()[0];
    } else if (cmd.includes('BEEP:STAT ON') || cmd.includes('BEEPER:STATE ON')) {
      deviceState.beeper = 'ON';
    } else if (cmd.includes('BEEP:STAT OFF') || cmd.includes('BEEPER:STATE OFF')) {
      deviceState.beeper = 'OFF';
    } else if (cmd === 'SYST:LOC' || cmd === 'SYSTEM:LOCAL') {
      deviceState.remoteMode = false;
    } else if (cmd === 'SYST:REM' || cmd === 'SYSTEM:REMOTE') {
      deviceState.remoteMode = true;
    }
    broadcastDeviceState();
  } catch (err) {
    console.error('Error syncing state from manual command:', err);
  }
}

// RESTART DYNAMIC SAMPLING TIMER
function restartQueryInterval() {
  if (queryInterval) {
    clearInterval(queryInterval);
    queryInterval = null;
  }

  isQuerying = false;
  console.log(`[INTERVAL] Starting sampling loop every ${querySpeedMs}ms...`);

  queryInterval = setInterval(async () => {
    if (isQuerying) return; // Prevent overlapping queries
    isQuerying = true;

    try {
      if (deviceState.isSimulator) {
        // SIMULATED SAMPLING
        const mainVal = getSimulatedReading();
        const subVal = getSimulatedSubReading();
        const isOL = mainVal.includes('+37') || mainVal.includes('+38') || Math.abs(parseFloat(mainVal)) >= 9e37;
        
        broadcastToAll({
          type: 'reading',
          timestamp: Date.now(),
          mainValue: isOL ? null : parseFloat(mainVal),
          mainRaw: mainVal,
          subValue: subVal !== 'NONe' ? parseFloat(subVal) : null,
          subRaw: subVal,
          func1: deviceState.func1,
          func2: deviceState.func2,
          range: deviceState.range,
          speed: deviceState.speed,
          isOL
        });
      } else {
        // PHYSICAL HARDWARE SAMPLING
        if (activePort && activePort.isOpen) {
          // Sync state round-robin so we never choke the serial bus
          queryCycle++;
          try {
            if (queryCycle === 10) {
              const f1 = await sendSCPICommand('FUNC1?');
              if (f1) {
                const cleanF = f1.replace(/['"]/g, '').trim().toUpperCase();
                if (validModes[cleanF] && deviceState.func1 !== validModes[cleanF]) {
                  deviceState.func1 = validModes[cleanF];
                  broadcastDeviceState();
                }
              }
            } else if (queryCycle === 20) {
              const rng = await sendSCPICommand('AUTO?');
              if (rng) {
                const nextRange = (rng.trim() === '1') ? 'AUTO' : 'MANUAL';
                if (deviceState.range !== nextRange) {
                  deviceState.range = nextRange;
                  broadcastDeviceState();
                }
              }
            } else if (queryCycle === 30) {
              const spd = await sendSCPICommand('RATE?');
              if (spd && spd.trim()) {
                const nextSpeed = spd.trim()[0];
                if (deviceState.speed !== nextSpeed) {
                  deviceState.speed = nextSpeed;
                  broadcastDeviceState();
                }
              }
            } else if (queryCycle === 40) {
              const f2 = await sendSCPICommand('FUNC2?');
              if (f2) {
                const nextF2 = f2.replace(/['"]/g, '').trim().toUpperCase();
                if (deviceState.func2 !== nextF2) {
                  deviceState.func2 = nextF2;
                  broadcastDeviceState();
                }
              }
            } else if (queryCycle >= 50) {
              queryCycle = 0;
              const beep = await sendSCPICommand('SYST:BEEP:STAT?');
              if (beep) {
                const nextBeep = (beep.trim() === '1') ? 'ON' : 'OFF';
                if (deviceState.beeper !== nextBeep) {
                  deviceState.beeper = nextBeep;
                  broadcastDeviceState();
                }
              }
            }
          } catch (syncErr) {
            console.warn('[SYNC WARNING] Failed round-robin sync:', syncErr.message);
          }

          const rawReading = await sendSCPICommand('MEAS?');
          if (rawReading && rawReading !== '(sent)') {
            const timestamp = Date.now();
            
            // If dual display is active, OWON returns "main_value,sub_value"
            const parts = rawReading.split(',');
            const mainRaw = parts[0].trim();
            const subRaw = parts[1] ? parts[1].trim() : 'NONe';

            const mainNum = parseFloat(mainRaw);
            const subNum = (subRaw && subRaw !== 'NONe') ? parseFloat(subRaw) : null;
            const isOL = Math.abs(mainNum) >= 1e37 || (mainRaw.includes('9.9') && mainRaw.includes('37')) || mainRaw.toUpperCase().includes('OL') || mainRaw.toUpperCase().includes('O.L');

            broadcastToAll({
              type: 'reading',
              timestamp,
              mainValue: isOL ? null : mainNum,
              mainRaw,
              subValue: subNum,
              subRaw,
              func1: deviceState.func1,
              func2: deviceState.func2,
              range: deviceState.range,
              speed: deviceState.speed,
              isOL
            });
          }
        }
      }
    } catch (err) {
      console.error('[SAMPLING TIMER ERROR]', err.message);
    } finally {
      isQuerying = false;
    }
  }, querySpeedMs);
}

// Initial state: Idle / Waiting for connection
deviceState.connected = false;
deviceState.isSimulator = false;
deviceState.portName = 'NOT CONNECTED';

// Run express/websocket server
server.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🚀 OWON XDM2041 Modern Controller Server is up and running!`);
  console.log(`🔗 Interface available in browser: http://localhost:${PORT}`);
  console.log(`⚙️  Running in Simulator Mode by default for a perfect trial.`);
  console.log(`=============================================================\n`);
});
