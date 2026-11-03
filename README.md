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
pnpm build       # build de producción en ./docs
pnpm preview     # servir el build
pnpm check       # type-check de Astro + TS
pnpm test:strategy # comprobar fronteras, conexiones y tropas iniciales
pnpm exec playwright install chromium # instalar el navegador de pruebas (una vez)
pnpm test:e2e    # probar la portada y el juego en escritorio y móvil
```

## Estructura

```
src/
  data/games.ts                     # ← lista de juegos (única fuente de verdad)
  pages/index.astro                 # landing
  pages/juegos/[slug].astro         # página de cada juego (generada desde games.ts)
  lib/games/registry.ts             # slug → función de montaje Phaser
  lib/games/strategy-game-world/    # lógica, mapa y escenas del juego
  scripts/build-world.mjs           # genera el mapa y sus conexiones
  components/                       # Layout, Header, Footer, GameCard
```

## Cómo agregar un juego

1. Agregar la entrada en `src/data/games.ts` (la landing y la ruta se generan solas).
2. Crear `src/lib/games/<slug>/` con su config de Phaser y sus escenas.
3. Registrar el mount en `src/lib/games/registry.ts`.
4. Cambiar `status` a `'available'` cuando esté jugable.

## Estado actual

- **Strategy Game World** — jugable contra la computadora. Selecciona un país propio: el borde celeste indica una victoria prevista, el dorado un ataque posible que perderías y el verde permite mover tropas. Para conquistar necesitas más tropas en el país atacante que en el defensor; los empates favorecen al defensor.
- La partida comienza mostrando el mapa completo. Arrástralo para desplazarte y usa la rueda o los botones `+` y `−` para acercarlo y alejarlo, también en móvil.
- Las tropas iniciales dependen del área del país y varían entre partidas, con la misma regla para territorios neutrales, del jugador y de la computadora. Cada bando recibe refuerzos a partir de su segundo turno.
- Los países iniciales se sortean entre todos los territorios jugables, sin restringir su tamaño, continente o distancia; nunca se asigna el mismo país a ambos bandos.
- Los territorios diminutos se fusionan con sus vecinos o se omiten si son islas aisladas; los demás cuentan con rutas conectadas.
- Para actualizar el mapa después de modificar el generador, ejecuta `node scripts/build-world.mjs` y luego `pnpm test:strategy`.

## Publicación en GitHub Pages

Ejecuta `pnpm build` y publica la carpeta `docs` desde la rama elegida en la configuración de GitHub Pages. El build copia `CNAME` y `.nojekyll` desde `public`; el dominio personalizado es `games.devcito.org`. Configura también el DNS del dominio para que apunte a GitHub Pages.
