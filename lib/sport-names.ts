// Tłumaczenie typów aktywności (sport_type / type ze Stravy) na polski —
// WYŁĄCZNIE do wyświetlania. W bazie trzymamy oryginalne wartości Stravy,
// więc tłumaczymy dopiero w widoku. Nieznane typy zwracamy bez zmian.
const SPORT_PL: Record<string, string> = {
  Run: 'Bieg',
  TrailRun: 'Bieg terenowy',
  VirtualRun: 'Bieg wirtualny',
  Ride: 'Jazda rowerem',
  MountainBikeRide: 'Rower górski',
  GravelRide: 'Gravel',
  VirtualRide: 'Jazda wirtualna',
  EBikeRide: 'Rower elektryczny',
  EMountainBikeRide: 'Rower górski elektryczny',
  Velomobile: 'Welomobil',
  Swim: 'Pływanie',
  Walk: 'Marsz',
  Hike: 'Wędrówka',
  WeightTraining: 'Trening siłowy',
  Workout: 'Trening',
  Crossfit: 'Crossfit',
  Yoga: 'Joga',
  Pilates: 'Pilates',
  Elliptical: 'Orbitrek',
  StairStepper: 'Stepper',
  Rowing: 'Wioślarstwo',
  VirtualRow: 'Wioślarstwo wirtualne',
  Kayaking: 'Kajakarstwo',
  Canoeing: 'Kajakarstwo kanadyjskie',
  StandUpPaddling: 'SUP',
  Surfing: 'Surfing',
  Kitesurf: 'Kitesurfing',
  Windsurf: 'Windsurfing',
  Sail: 'Żeglarstwo',
  Skateboard: 'Deskorolka',
  InlineSkate: 'Rolki',
  IceSkate: 'Łyżwiarstwo',
  AlpineSki: 'Narciarstwo zjazdowe',
  BackcountrySki: 'Skitury',
  NordicSki: 'Narciarstwo biegowe',
  Snowboard: 'Snowboard',
  Snowshoe: 'Rakiety śnieżne',
  RockClimbing: 'Wspinaczka',
  Golf: 'Golf',
  Soccer: 'Piłka nożna',
  Tennis: 'Tenis',
  Badminton: 'Badminton',
  Squash: 'Squash',
  TableTennis: 'Tenis stołowy',
  Pickleball: 'Pickleball',
  Racquetball: 'Racquetball',
  Wheelchair: 'Wózek',
  Handcycle: 'Handbike',
  HighIntensityIntervalTraining: 'Trening interwałowy (HIIT)',
  Inne: 'Inne',
};

// Zwraca polską nazwę typu aktywności; dla nieznanych typów oddaje oryginał.
export function sportPl(sport?: string | null): string {
  const key = (sport ?? '').trim();
  if (!key) return '';
  return SPORT_PL[key] ?? key;
}

// Wszystkie znane typy aktywności (klucze Stravy) w kolejności ze słownika —
// do selektorów w panelu /manual. 'Inne' zostaje na końcu.
export const SPORT_KEYS = Object.keys(SPORT_PL);
