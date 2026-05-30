# TenDots

A quiet number puzzle for iPhone. Tap two cells that match or sum to ten, with reading-order, column, or diagonal adjacency. Goal: clear the board in the fewest "adds."

- **Support:** https://kiddkevin00.github.io/tendots/
- **Privacy:** https://kiddkevin00.github.io/tendots/privacy.html

## Notes on the genre

The same-or-sum-to-ten mechanic is a long-running pen-and-paper puzzle (sometimes called "Take Ten" or "Numerica"). TenDots is an original implementation of that mechanic — own UI, own code, own branding. No assets, naming, or art from any specific app were reused.

## Stack

Expo SDK 54, React 19.1, RN 0.81, TypeScript. `expo-haptics`, AsyncStorage. No game-engine dependency.

## Local dev

```sh
npm install
npx expo start --tunnel
```

## App Store checklist

- [done] Bundle id `com.markutilitylabs.tendots`, display name, version — `app.json`
- [done] Privacy + Support URLs (see top)
- [you] Apple Developer enrollment, Xcode 17+ or EAS, App Store Connect listing with "Data Not Collected" nutrition labels

## License

MIT — see `LICENSE`.
