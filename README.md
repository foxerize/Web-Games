# Web Games

A GitHub Pages game hub with small browser games.

Current games:

- `games/connect-four/` — two-player Connect Four with rooms, chat, host controls, and Firebase sync.
- `games/checkers/` — two-player Checkers with rooms, host controls, and Firebase sync.
- Custom Wordle currently links out to `https://foxerize.github.io/Custom-Wordle/`.

## Structure

```txt
index.html
styles.css
firebase-config.js
database.rules.json
games/
  connect-four/
    index.html
    app.js
  checkers/
    index.html
    app.js
```

## One-time Firebase setup

1. In **Firebase Console**, open your project and click **Add app → Web**. Register it. Hosting is not required. Copy the `firebaseConfig` object into [firebase-config.js](firebase-config.js).
2. Open **Build → Authentication → Sign-in method** and enable **Anonymous**.
3. Open **Build → Realtime Database** and create a database.
4. In the Realtime Database **Rules** tab, replace the default rules with the contents of [database.rules.json](database.rules.json), then publish them.
5. Push to `main`. In GitHub **Settings → Pages**, select **GitHub Actions** as the deployment source.

## Firebase paths

Each multiplayer game uses its own database namespace:

```txt
connectFourRooms/{roomId}
checkersRooms/{roomId}
```

That keeps different games from accidentally reading or writing each other’s room data.

## Security scope

The included rules require anonymous Firebase sign-in and restrict each room to its two player slots. Players can read a room when they know its code, so this is appropriate for casual games among friends, not competitive or trusted-score systems. For cheat-resistant play, move move-validation into Firebase Cloud Functions.
