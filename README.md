# DevCito Games 🎮

Landing + colección de juegos web hechos con [Astro](https://astro.build) y [Phaser](https://phaser.io).

## Stack

- **Astro 5** — sitio estático, islands solo donde hace falta
- **TypeScript** — estricto
- **Phaser 3** — motor de juegos, corriendo en el navegador

## Comandos

```bash
pnpm install     # instalar dependencias
pnpm dev         # entorno local en http://localhost:4321
pnpm build       # build de producción en ./dist
pnpm preview     # servir el build
pnpm check       # type-check de Astro + TS
```

## Estructura

```
src/
  data/games.ts                     # ← lista de juegos (única fuente de verdad)
  pages/index.astro                 # landing
  pages/juegos/[slug].astro         # página de cada juego (generada desde games.ts)
  lib/games/registry.ts             # slug → función de montaje Phaser
  lib/games/strategy-game-world/    # el juego (hoy: escena placeholder)
    index.ts                        #   config de Phaser + mount
    scenes/MainScene.ts             #   teaser con grilla hexagonal
  components/                       # Layout, Header, Footer, GameCard
```

## Cómo agregar un juego

1. Agregar la entrada en `src/data/games.ts` (la landing y la ruta se generan solas).
2. Crear `src/lib/games/<slug>/` con su config de Phaser y sus escenas.
3. Registrar el mount en `src/lib/games/registry.ts`.
4. Cambiar `status` a `'available'` cuando esté jugable.

## Estado actual

- **Strategy Game World** — 🔜 próximamente. El canvas de Phaser ya está montado con una escena teaser; solo falta el juego real.
