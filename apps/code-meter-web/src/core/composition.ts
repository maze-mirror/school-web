import { emptyCounts, localDateKey, type LanguageStat, type Snapshot } from './index'

/** Same local-day and repeated-scan semantics as the activity grid. */
export function dailyComposition(snapshots: Snapshot[], date: string) {
  const languages = new Map<string, LanguageStat>()
  let scans = 0
  for (const snapshot of snapshots) {
    if (localDateKey(new Date(snapshot.scannedAt)) !== date) continue
    scans++
    for (const source of snapshot.languages) {
      const entry = languages.get(source.language) ?? {
        language: source.language,
        name: source.name,
        files: 0,
        counts: emptyCounts(),
      }
      entry.files += source.files
      for (const key of Object.keys(entry.counts) as (keyof typeof entry.counts)[]) {
        entry.counts[key] += source.counts[key]
      }
      languages.set(source.language, entry)
    }
  }
  const rows = [...languages.values()].sort((a, b) => b.counts.code - a.counts.code)
  return { languages: rows, code: rows.reduce((sum, row) => sum + row.counts.code, 0), scans }
}
