# create-runbutter

Set up a self-hosted [RunButter](https://runbutter.app) — the open company OS —
in one command.

```bash
npx create-runbutter
```

It checks your machine, clones the repository, generates every secret the stack
needs, asks for a Privy app id, and starts the containers. Open
<http://localhost:3000>.

## Options

```bash
npx create-runbutter [directory] [options]

  --privy-app-id <id>   Skip the prompt (free, dashboard.privy.io)
  --no-start            Set everything up but don't run docker compose
  --branch <name>       Clone a branch other than the default
  --help
```

## Why not `npm install runbutter`

`npm install` is for libraries you import into your own code. RunButter is an
application with a Postgres database behind it, so there is nothing to import —
what you want is a scaffolder that runs once and leaves you with something
running. That is this.

## What it needs

**Node 18+** and **git**. **Docker** is optional: without it you still get a
clone and a complete `.env`, and the output tells you how to point the app at a
hosted Postgres instead.

**A Privy app id.** Authentication is [Privy](https://privy.io), which is a
hosted service — free, about two minutes, and unavoidable in this stack. It is
asked for up front rather than discovered halfway through. Everything else —
your data, your files, your API — stays on your machine.

## What it will not do

- **Overwrite anything.** It refuses to install into a directory that already
  has files in it.
- **Reissue secrets that already exist.** Re-running against a configured `.env`
  keeps what is there; regenerating a master key would orphan everything sealed
  with the old one.
- **Report success it has not verified.** The keys are read back out of the
  written `.env` before it says the file is ready.

MIT licensed, like RunButter.
