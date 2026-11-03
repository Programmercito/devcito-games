export type GameStatus = 'available' | 'coming-soon';

export interface Game {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  genre: string;
  status: GameStatus;
  /** CSS gradient used for the card art until real artwork exists. */
  accent: string;
}

export const games: Game[] = [
  {
    slug: 'strategy-game-world',
    title: 'Strategy Game World',
    tagline: 'Conquista el mundo, un turno a la vez.',
    description:
      'Un juego de estrategia por turnos en tu navegador. Explora, expande tu imperio y domina el mapa mundial. Totalmente gratis, sin descargas.',
    genre: 'Estrategia',
    status: 'available',
    accent: 'linear-gradient(135deg, #1e3a8a 0%, #0ea5e9 55%, #22d3ee 100%)',
  },
];

export function getGame(slug: string): Game | undefined {
  return games.find((g) => g.slug === slug);
}
