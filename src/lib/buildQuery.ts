/**
 * buildQuery.ts — Pure functions: controls → SQL strings
 */

export const S3_GLOB = `'s3://obis-products/speciesgrids/h3_7/*'`;

export interface SpeciesControls {
  species:      string;
  yearMin:      number | null;
  yearMax:      number | null;
  h3Resolution: 3|4|5|6|7;
}

export function buildSpeciesQuery(c: SpeciesControls): string {
  const safe = c.species.replace(/'/g, "''");

  const filters = [`species = '${safe}'`];
  if (c.yearMin) filters.push(`max_year >= ${c.yearMin}`);
  if (c.yearMax) filters.push(`min_year <= ${c.yearMax}`);

  const cellExpr = c.h3Resolution < 7
    ? `h3_cell_to_parent(cell, ${c.h3Resolution})`
    : `cell`;

  return `
SELECT
  ${cellExpr} AS cell,
  SUM(records)::BIGINT AS value
FROM (
  SELECT cell, records, min_year, max_year
  FROM read_parquet(${S3_GLOB})
  WHERE ${filters.join('\n    AND ')}
)
GROUP BY cell
ORDER BY value DESC
`.trim();
}

export interface AreaControls {
  wkt:          string;
  metric:       'species' | 'records';
  h3Resolution: 3|4|5|6|7;
  yearMin:      number | null;
  yearMax:      number | null;
}

export function buildAreaQuery(c: AreaControls): string {
  const safe = c.wkt.replace(/'/g, "''");

  const dateFilters: string[] = [];
  if (c.yearMin) dateFilters.push(`min_year >= ${c.yearMin}`);
  if (c.yearMax) dateFilters.push(`max_year <= ${c.yearMax}`);
  const whereDate = dateFilters.length ? `AND ${dateFilters.join(' AND ')}` : '';

  const cellExpr = c.h3Resolution < 7
    ? `h3_cell_to_parent(cell, ${c.h3Resolution})`
    : `cell`;

  const metricExpr = c.metric === 'species'
    ? `COUNT(DISTINCT species)::INTEGER AS value`
    : `SUM(records)::BIGINT AS value`;

  return `
SELECT
  ${cellExpr} AS cell,
  ${metricExpr}
FROM read_parquet(${S3_GLOB})
WHERE ST_Intersects(
        geometry,
        ST_GeomFromText('${safe}')
      )
  ${whereDate}
GROUP BY cell
ORDER BY value DESC
`.trim();
}
