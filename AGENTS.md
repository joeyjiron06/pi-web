# PI Web

This is a web project for Pi coding agent. There is an existing terminal app, but I decided to build this web project to have a better interface and be able to access it remotely.

## Deployment / Threat Model

This server is meant to be run locally and only accessed within a private network (e.g. LAN or VPN). It will never be exposed to the public internet, so server-side APIs may freely read from and operate on the local filesystem without path allowlists or auth.

## Tech Stack

- React Router (framework mode)
- ShadCN UI react library

## React Component Rules

- Always wrap computations of values in `useMemo` hooks to avoid expensive computations on every rerender. Things that are ok are boolean checks or boolean negations, everything else should be in a `useMemo`
- Use the `useCallback` hook for all click handlers. Don't inline function calls.
- DO NOT call setters or do any other work in the function scope of a react function component since it's called on every rerender. use the `useEffect` hook to listen for changes and call setters if needed.
