import type { ReactElement } from 'react';
import type { CatalogColors } from '@wi/shared';

interface Props {
  archetype: string;
  colors: CatalogColors;
  size?: number;
  title?: string;
}

/** Tiny flat silhouette of a species, drawn from its archetype and catalog colours. */
export function SpeciesThumb({ archetype, colors, size = 36, title }: Props) {
  const { back, side, belly, fin } = colors;
  const id = `g${(back + side + belly).replace(/#/g, '')}${archetype}`;
  const defs = (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={back} />
        <stop offset="0.55" stopColor={side} />
        <stop offset="1" stopColor={belly} />
      </linearGradient>
    </defs>
  );
  let body: ReactElement;
  switch (archetype) {
    case 'anguilliform':
      body = (
        <path
          d="M2 20 C10 8 14 30 22 18 S34 10 38 16 L38 22 C32 18 28 30 22 26 S10 14 2 24Z"
          fill={`url(#${id})`}
        />
      );
      break;
    case 'elongate':
      body = (
        <>
          <path d="M2 20 L10 16 L32 15 L38 8 L38 32 L32 25 L10 24Z" fill={`url(#${id})`} />
          <path d="M26 15 L30 10 L32 15Z" fill={fin} />
        </>
      );
      break;
    case 'compressed':
      body = (
        <>
          <ellipse cx="18" cy="20" rx="14" ry="12" fill={`url(#${id})`} />
          <path d="M30 20 L38 11 L38 29Z" fill={fin} />
          <path d="M10 9 Q18 2 26 9Z" fill={fin} />
        </>
      );
      break;
    case 'benthic':
      body = (
        <>
          <path
            d="M2 22 Q6 14 18 15 L32 19 L38 13 L38 29 L32 24 L18 27 Q6 28 2 22Z"
            fill={`url(#${id})`}
          />
          <path d="M4 26 L8 32 L12 27Z" fill={fin} />
        </>
      );
      break;
    case 'turtle':
      body = (
        <>
          <ellipse cx="20" cy="22" rx="14" ry="9" fill={side} />
          <ellipse cx="20" cy="20" rx="12" ry="7" fill={back} />
          <circle cx="36" cy="20" r="3.4" fill={belly} />
          <path d="M8 28 L4 34 M30 28 L34 34" stroke={fin} strokeWidth="3" strokeLinecap="round" />
        </>
      );
      break;
    case 'frog':
      body = (
        <>
          <ellipse cx="20" cy="22" rx="11" ry="8" fill={side} />
          <circle cx="14" cy="13" r="3" fill={back} />
          <circle cx="26" cy="13" r="3" fill={back} />
          <path d="M8 28 L2 34 M32 28 L38 34" stroke={fin} strokeWidth="3" strokeLinecap="round" />
        </>
      );
      break;
    case 'crayfish':
    case 'crab':
      body = (
        <>
          <ellipse cx="20" cy="22" rx={archetype === 'crab' ? 12 : 8} ry="8" fill={side} />
          <path d="M8 14 L2 6 L10 8Z M32 14 L38 6 L30 8Z" fill={fin} />
          <path
            d="M10 28 L4 34 M16 30 L14 36 M24 30 L26 36 M30 28 L36 34"
            stroke={back}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      );
      break;
    case 'mussel':
      body = (
        <>
          <path d="M4 28 Q4 10 20 10 Q36 10 36 28Z" fill={side} />
          <path
            d="M8 26 Q8 14 20 14 M14 26 Q14 18 20 18"
            stroke={back}
            strokeWidth="1.6"
            fill="none"
          />
        </>
      );
      break;
    case 'plant':
      body = (
        <>
          <path
            d="M8 36 Q4 22 10 8 M18 36 Q16 20 20 6 M28 36 Q32 22 28 10"
            stroke={side}
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse cx="32" cy="30" rx="6" ry="2.5" fill={belly} />
        </>
      );
      break;
    case 'mammal':
      body = (
        <>
          <ellipse cx="18" cy="22" rx="15" ry="9" fill={`url(#${id})`} />
          <circle cx="34" cy="18" r="5" fill={side} />
          <path d="M3 22 L-1 30 L8 26Z" fill={fin} />
        </>
      );
      break;
    case 'small':
      body = (
        <>
          <path d="M4 20 Q16 12 28 20 Q16 28 4 20Z" fill={`url(#${id})`} />
          <path d="M28 20 L37 13 L37 27Z" fill={fin} />
        </>
      );
      break;
    default:
      body = (
        <>
          <path d="M2 20 Q14 8 28 18 L37 10 L37 30 L28 22 Q14 32 2 20Z" fill={`url(#${id})`} />
          <path d="M14 11 Q20 6 26 14Z" fill={fin} />
        </>
      );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={title ?? archetype}
      style={{ flex: 'none' }}
    >
      {defs}
      {body}
      {archetype !== 'plant' &&
        archetype !== 'mussel' &&
        archetype !== 'turtle' &&
        archetype !== 'frog' &&
        archetype !== 'crab' &&
        archetype !== 'crayfish' && <circle cx="8" cy="18" r="1.3" fill="#111" />}
    </svg>
  );
}
