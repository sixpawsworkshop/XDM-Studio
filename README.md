# 🎛️ OWON XDM2041 - Intelligent Dark Dashboard & Controller

Un panou digital de control și monitorizare modern, optimizat, dark-themed, special conceput pentru multimetrul de banc **OWON XDM2041**. Sistemul este format dintr-un server robust de comunicație scris în **Node.js** și o interfață web interactivă, fluidă și responsivă bazată pe WebSockets și Chart.js.

---

## 🚀 Caracteristici Principale / Key Features

1. **Afișaj OLED Digital de Mare Rezoluție (Live Readout)**:
   * Redare numerică clară cu font retro/futuristic cu reflexii de neon cyan.
   * Adaptare automată a zecimalelor în funcție de viteza de citire (F/M/L) și funcția selectată.
   * Afișaj secundar complet integrat (ex: vizualizarea frecvenței rețelei simultan cu tensiunea AC).
   * Indicatori LED pentru starea Beeper-ului, Modul Remote (RMT) și Scala Activă.
   * Suport complet pentru indicarea stării de depășire de scală (**O.L** - Overload).

2. **Panou Control Instrument (Multimeter Remote Control)**:
   * **Selector de Funcții**: Grid interactiv cu butoane luminate neon pentru toate modurile aparatului (Tensiune DC/AC, Curent DC/AC, Rezistență 2-wire / 4-wire, Capacitate, Frecvență, Periodă, Temperatură RTD, Diode și Continuitate).
   * **Scală (Range)**: Comutare rapidă între modurile AUTO și scalare manuală (cu opțiuni specifice modului activ populate dinamic).
   * **Viteză (Rate)**: Setare timp de integrare/viteză citire direct de pe ecran (Rapid / Mediu / Lent).
   * **Buzzer Local & Intern**: Activare/dezactivare beeper fizic din instrument și buton de testare manuală a buzzer-ului.

3. **Mod Simulator Integrat (High-Fidelity Simulator)**:
   * Pornește implicit în **Modul Simulator** dacă nu este conectat niciun multimetru fizic.
   * Generează măsurători realiste cu zgomot fin și derive de temperatură / descarcare pentru a permite testarea, evaluarea și demonstrarea tuturor funcțiilor în siguranță!
   * Simulatorul răspunde complet la consolele SCPI exact ca aparatul real.

4. **Grafic și Analiză în Timp Real (Dynamic Chart.js)**:
   * Plotare fluidă, ultra-rapidă, fără lag.
   * Filtru glisant pentru fereastra de vizualizare (ultimele 30, 100, 500 de citiri sau întreaga sesiune).
   * Opțiune de pauză/înghețare grafic și golire date.

5. **Configurare Alarme & Limite Inteligente (Visual & Acoustic Alarms)**:
   * Setare prag minim și prag maxim cu testare în timp real.
   * Depășirea pragurilor declanșează o alertă vizuală (flashing red overlay pe ecran) și o alertă acustică (sunet sinusoidal de 1200Hz generat direct prin Web Audio API, fără fișiere audio!).

6. **Înregistrator de Date și Exporturi (Data Logger)**:
   * Tabel istoric de măsurători logate cu marcaj temporal la milisecundă.
   * Slider de reglaj al intervalului de citire / eșantionare (de la 100 ms până la 10 secunde).
   * Butoane de descărcare directă a datelor în format **CSV** și **JSON** pentru analize ulterioare în Excel, Python sau MATLAB.

7. **Consolă Terminal SCPI (Developer Terminal)**:
   * Trimiteți comenzi SCPI direct către aparat (ex: `*IDN?`, `MEAS?`, `*RST`, etc.) și citiți buffer-ul de răspuns în timp real.
   * Include butoane rapide pentru comenzile frecvente din manualul tehnic.

---

## 🛠️ Cerințe și Pregătire / Requirements

* **Node.js**: Versiunea v18 sau mai nouă (Sistemul dumneavoastră are deja **v24.21.0** instalat!).
* **Aparatul OWON XDM2041** conectat prin cablu USB la computer (utilizează driverul USB-CDC Virtual COM Port, asigurat de Windows sau de cipul de comunicare CH340 / similar).

---

## ⚙️ Rulare Proiect Pas cu Pas / How to Run

Urmați acești pași simpli pentru a porni aplicația:

### Pasul 1: Instalarea Dependențelor
Deschideți un terminal (PowerShell, CMD sau terminalul din editorul dvs.) în folderul proiectului `D:\Gemini\OWON` și executați comanda următoare pentru a descărca pachetele necesare:

```bash
npm install
```

*Notă: Dependențele sunt Express (server web static și API) și WS (WebSockets de mare viteză). Librăria optională `serialport` va fi instalată automat. Dacă mediul dumneavoastră nu are compilatoare native C++ instalate, nu vă faceți griji! Serverul prinde erorile elegant și pornește oricum în modul Simulator.*

### Pasul 2: Pornirea Serverului
Rulați comanda de pornire a serverului Node:

```bash
npm start
```

Ar trebui să vedeți un mesaj de succes în consolă:
```text
=============================================================
🚀 OWON XDM2041 Modern Controller Server is up and running!
🔗 Interface available in browser: http://localhost:3000
⚙️ Running in Simulator Mode by default for a perfect trial.
=============================================================
```

### Pasul 3: Accesarea Interfeței
Deschideți browserul preferat (Chrome, Edge, Firefox, Brave) și accesați:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🔌 Conectarea la Multimetrul Fizic Real / Real Multimeter Setup

Atunci când doriți să citiți date de pe aparatul fizic real, parcurgeți următoarea procedură simplă:

1. Conectați multimetrul OWON XDM2041 pornit la computer utilizând cablul USB.
2. În interfața web din browser, în zona de sus (dreapta header-ului):
   * Dați click pe dropdown-ul **Port Serial** (`cable` icon). Serverul va scana automat porturile active și va afișa portul corect (ex: `COM3`, `COM4` etc.).
   * Selectați portul corect corespunzător instrumentului.
   * Selectați rata Baud (**115200** baud este valoarea implicită și recomandată pentru OWON XDM2041, însă puteți alege și **9600** conform configurării din meniul fizic al aparatului).
3. Faceți clic pe butonul **Conectare**.
4. Badge-ul de stare din stânga va deveni verde și va afișa: **Port Activ: COMx**.
5. Gata! Multimetrul intră în modul de control la distanță (pe ecranul fizic se va aprinde sigla `RMT` / Remote). Datele, setările și butoanele de pe ecran vor fi perfect sincronizate cu aparatul dvs. fizic în timp real!
6. Pentru a deconecta aparatul fizic și a reveni la simulator, pur și simplu faceți click pe butonul roșu de **Deconectare**.

---

## 📚 Comenzi SCPI Rapide din Manual (Quick Reference)

Puteți experimenta în consola terminal SCPI cu următoarele comenzi descrise în manualul integrat:
* `*IDN?` - Solicită modelul, seria și versiunea de firmware.
* `MEAS?` - Solicită valoarea curentă afișată pe ecran.
* `FUNC1 "VOLT AC"` - Schimbă modul principal în Tensiune Alternativă.
* `FUNC2 "FREQ"` - Pornește ecranul secundar pentru citirea frecvenței.
* `FUNC2 "NONE"` - Închide ecranul secundar.
* `RATE F` - Modifică viteza de eșantionare la RAPID.
* `SYST:BEEP` - Declanșează un semnal acustic scurt în aparat.
* `SYST:LOC` - Deblochează butoanele fizice de pe panoul aparatului, revenind la control local.

---

## 📂 Structura Proiectului / Code Map

* `server.js` - Serverul Node.js Express & WebSocket. Coordonează comunicările seriale și simulează un instrument SCPI.
* `package.json` - Management de script-uri și pachete npm.
* `public/index.html` - Structura vizuală a tabloului de bord, optimizată cu Tailwind și Google Fonts.
* `public/style.css` - Stiluri customizate cybernetic, efecte de oled glowing și animații de alarmă.
* `public/app.js` - Logica de client Web: gestionare socket, calcule matematice, alertă acustică, grafic live și descărcări CSV.
* `XDM2041_programming_manual.pdf` - Manualul oficial cu instrucțiuni și comenzi SCPI.

---
*Proiect dezvoltat de Gemini CLI ca soluție inteligentă, complexă și ultra-modernă pentru măsurători industriale și de laborator.*
