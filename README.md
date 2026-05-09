# Pavel and Sid's Briscola

A sleek old-school Italian Briscola web app for two players.

## Modes
- **Single player:** play against the computer.
- **Multiplayer:** Pavel and Sid log in by name, join the same room code, and play live over Socket.io.
- Toggle point values on/off.

## Run

```bash
npm install
npm start
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

For multiplayer, open two browser windows/devices, choose Multiplayer, enter `Pavel` in one and `Sid` in the other, and use the same room code.

## Briscola deck/rules
Uses normal American-style card faces/suits but the 40-card Briscola deck: A, 2, 3, 4, 5, 6, 7, J, Q, K. Point values: A=11, 3=10, K=4, Q=3, J=2, others=0.
