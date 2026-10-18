import { CarFront, CassetteTape, CloudMoon, CloudRain, Moon, Orbit, Siren, Sunrise, type LucideIcon } from 'lucide-react';
import type { MoodId } from '@shared/index';

export const STATIONS: Record<MoodId, { label: string; Icon: LucideIcon }> = {
  dreamy: { label: 'Dreamy', Icon: CloudMoon },
  sunrise: { label: 'Sunrise', Icon: Sunrise },
  nostalgic: { label: 'Nostalgic', Icon: CassetteTape },
  drive: { label: 'Night Drive', Icon: CarFront },
  chase: { label: 'Chase', Icon: Siren },
  dark: { label: 'Dark', Icon: Moon },
  noir: { label: 'Neon Noir', Icon: CloudRain },
  space: { label: 'Space', Icon: Orbit },
};
