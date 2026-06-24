# Connect Four Rooms

A two-player Connect Four game: GitHub Pages hosts the client; Firebase Realtime Database synchronizes each room.

## One-time Firebase setup

1. In **Firebase Console**, open your project and click **Add app → Web**. Register it (hosting is not required). Copy the `firebaseConfig` object into [firebase-config.js](firebase-config.js).
2. Open **Build → Authentication → Sign-in method** and enable **Anonymous**.
3. Open **Build → Realtime Database**, create a database, then choose the same region you expect most players to use.
4. In the Realtime Database **Rules** tab, replace the default rules with the contents of [database.rules.json](database.rules.json), then publish them.
5. Push to `main`. In GitHub **Settings → Pages**, select **GitHub Actions** as the deployment source.

After deployment, create a room and use **Copy invite link**. The second player opens the link and automatically joins as Yellow.

## Security scope

The included rules require anonymous Firebase sign-in and restrict each room to its two player slots. Players can read a room when they know its code, so this is appropriate for a casual game among friends, not a competitive or trusted-score system. For cheat-resistant play, move move-validation into a Firebase Cloud Function.
