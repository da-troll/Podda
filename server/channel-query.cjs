const SORTS = {
  newest: 'e.pub_date DESC NULLS LAST, e.id DESC',
  oldest: 'e.pub_date ASC NULLS LAST, e.id ASC',
  shortest: 'e.duration ASC NULLS LAST, e.id ASC',
  longest: 'e.duration DESC NULLS LAST, e.id DESC',
};
const WINDOWS = {
  '24h': 86400,
  '3d': 259200,
  '7d': 604800,
  '14d': 1209600,
  '30d': 2592000,
};
function channelQuery(query, userId, podcastId) {
  const sort = query.sort || 'newest';
  const status = query.status || 'any';
  if (
    !Object.hasOwn(SORTS, sort) ||
    !['any', 'unplayed', 'in-progress', 'played'].includes(status)
  )
    throw new Error('Invalid sort or status');
  if (
    query.hideCompleted != null &&
    !['true', 'false'].includes(query.hideCompleted)
  )
    throw new Error('Invalid hideCompleted');
  const params = [userId, podcastId];
  const conditions = [];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (query.hideCompleted === 'true')
    conditions.push('COALESCE(listen_completed, false) = false');
  if (status === 'unplayed')
    conditions.push(
      'COALESCE(listen_position, 0) = 0 AND COALESCE(listen_completed, false) = false',
    );
  if (status === 'in-progress')
    conditions.push(
      'listen_position > 0 AND COALESCE(listen_completed, false) = false',
    );
  if (status === 'played') conditions.push('listen_completed = true');
  if (query.released_after && query.released_after !== 'any') {
    if (!Object.hasOwn(WINDOWS, query.released_after))
      throw new Error('Invalid release window');
    conditions.push(
      `pub_date >= NOW() - (${bind(WINDOWS[query.released_after])} * INTERVAL '1 second')`,
    );
  }
  const integer = (key, fallback, min, max) => {
    if (query[key] == null) return fallback;
    const value = Number(query[key]);
    if (
      !/^\d+$/.test(String(query[key])) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    )
      throw new Error(`Invalid ${key}`);
    return value;
  };
  const minimum = integer('duration_min', null, 0, 2147483647);
  const maximum = integer('duration_max', null, 0, 2147483647);
  if (minimum != null && maximum != null && minimum > maximum)
    throw new Error('Minimum duration exceeds maximum');
  if (minimum != null) conditions.push(`duration >= ${bind(minimum)}`);
  if (maximum != null) conditions.push(`duration <= ${bind(maximum)}`);
  const after = integer('after', null, 1, 2147483647);
  if (after != null)
    conditions.push(
      `channel_rank > (SELECT channel_rank FROM ranked WHERE id = ${bind(after)})`,
    );
  const cte = `WITH ranked AS (
    SELECT e.*, lp.position AS listen_position, lp.completed AS listen_completed,
      lp.updated_at AS progress_updated_at,
      ROW_NUMBER() OVER (ORDER BY ${SORTS[sort]}) AS channel_rank
    FROM episodes e LEFT JOIN listen_progress lp ON lp.episode_id = e.id AND lp.user_id = $1
    WHERE e.podcast_id = $2
  )`;
  return {
    cte,
    where: conditions.length ? conditions.join(' AND ') : 'true',
    params,
    limit: integer('limit', 50, 1, 200),
    offset: integer('offset', 0, 0, 2147483647),
  };
}
module.exports = { channelQuery };
