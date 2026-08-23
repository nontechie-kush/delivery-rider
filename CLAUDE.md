# Delivery game

TypeScript + Vite. Canvas for the ride layer, DOM for everything else.
No game engine, no backend, no runtime map calls.

Keep this file short. Every line here is read on every request, and a long rules
file spends the attention that should go to the actual task.

## Non-negotiables

1. **Never weaken a test to make it pass.** A failing test means the code is wrong
   until proven otherwise. Deleting it, skipping it, or loosening an assertion is a
   bug report — say so and stop. Do not do it silently.

2. **Never silence a type error.** No `any`, no `@ts-ignore`, no non-null `!` added
   to get past the compiler. Same rule as above: the complaint is information.

3. **Never fabricate output.** No placeholder data, stub returns, or hardcoded values
   presented as working behaviour. If something cannot be implemented yet, leave it
   failing and say why.

4. **The simulation core is pure.** Everything under `src/sim/` takes inputs and
   returns outputs. No I/O, no `Date.now()`, no bare `Math.random()` — randomness
   comes from an injected seeded RNG. This is what makes the economy testable and
   balanceable, and it is the most important rule here.

5. **Modify existing code before adding new code.** Search for an existing function
   before writing one. Two implementations of the same rule is the single most likely
   way this codebase rots.

6. **Stay inside the blast radius you were given.** If a fix appears to require
   touching files outside the request, stop and say which files and why. Do not
   expand scope on your own initiative.

## Definition of done

A task is done when, and only when:

- `npm test` passes and you have pasted the actual output
- `npm run golden` matches the snapshot, or the snapshot was updated deliberately
- You have listed every file you changed and what changed in each

"Fixed" is not a status. If you did not run the checks, say you did not run them.

## The golden run

`npm run golden` replays 1000 shifts on a fixed seed and prints a checksum of total
earnings, orders completed, and milestone hits.

Any change under `src/sim/` that moves the checksum is an economy change.

- If it was intentional: update the snapshot in the same commit and state what moved.
- If it was not: that is a regression. **Revert. Do not patch forward.**

## Working agreement

**Plan first for anything touching more than one file.** Present the plan and wait.
A rejected plan costs a minute; a rejected implementation costs an afternoon and
leaves fragments behind.

**One bug, one fix, one commit.** Never batch unrelated changes. Commit only when
tests and the golden run are green, so every regression stays bisectable.

**Say what you changed, not that you changed it.** End every task with the file list
and one line per file, so the diff can be reviewed without hunting for it.

**Two strikes, then stop.** If the same bug survives two fix attempts, do not attempt
a third. Say you are stuck, and offer instrumentation that prints actual state at the
failure point instead. A wrong diagnosis repeated with more confidence is the exact
failure this rule exists to prevent.

**Flag uncertainty out loud.** If you are guessing at a cause, say it is a guess.
Confident wrong answers cost more here than admitted unknowns.

## Repo and infra

`github.com/nontechie-kush/delivery-rider` — public. Vercel hosts playtest builds
from `main`. Supabase for remote config first, then cloud save, then leaderboards.

**The game never blocks on the network.** Economy constants, map data, and
progression ship baked into the build. Supabase overrides them when reachable and is
otherwise invisible. Every feature must work fully offline — no spinners, no retries,
no degraded shift. Treat a network call that the game waits on as a bug.

**Never push without being asked.** Commit locally and freely; pushing happens only
after the change has been run and tested on this machine, and only when the user says
so. Never commit keys, ad unit IDs, service-role keys, or keystore files — anon key
in `.env`, `.env.example` committed with dummies.

## Style

- Files under ~300 lines. Split when they grow past it.
- Comment only non-obvious *why*. Never restate the code.
- Plain functions and plain objects. No classes unless the state has identity.
- No new dependencies without asking first.
