// Google content is returned for immediate display only. Persist place IDs only.
export const validPlaceId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(id);

interface Dependencies {
  authenticate: (authorization: string) => Promise<string | null>;
  consume: (userId: string) => Promise<boolean>;
  apiKey?: string;
  fetcher?: typeof fetch;
  origins?: string;
}

export function createGooglePlacesHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const headers = {
      'Access-Control-Allow-Origin': deps.origins || '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    };
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {status, headers});
    if (req.method === 'OPTIONS') return reply(200, {});
    if (req.method !== 'POST') return reply(405, {error: 'method_not_allowed'});
    try {
      const userId = await deps.authenticate(req.headers.get('Authorization') ?? '');
      if (!userId) return reply(401, {error: 'unauthorized'});
      if (!deps.apiKey) return reply(503, {error: 'places_unavailable'});
      // Bound body size before parsing, including chunked requests.
      if (!req.body) return reply(400, {error: 'invalid_request'});
      const reader = req.body.getReader();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 4096) {
          await reader.cancel();
          return reply(413, {error: 'request_too_large'});
        }
        chunks.push(value);
      }
      const buffer = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
      let body;
      try { body = JSON.parse(new TextDecoder().decode(buffer)); }
      catch { return reply(400, {error: 'invalid_request'}); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply(400, {error: 'invalid_request'});
      }
      const action = body.action;
      const session = body.session_token;
      const validSession = typeof session === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session);
      if ((action !== 'autocomplete' && action !== 'details') ||
          (action === 'autocomplete' && !validSession) ||
          (session !== undefined && !validSession)) {
        return reply(400, {error: 'invalid_request'});
      }
      const language = body.language === 'en' ? 'en' : 'it';
      let url: string;
      let init: RequestInit;
      const googleHeaders = {'X-Goog-Api-Key': deps.apiKey, 'Content-Type': 'application/json'};
      if (action === 'autocomplete') {
        if (typeof body.query !== 'string' || body.query.trim().length < 3 || body.query.length > 200) {
          return reply(400, {error: 'invalid_query'});
        }
        url = 'https://places.googleapis.com/v1/places:autocomplete';
        init = {
          method: 'POST',
          headers: {...googleHeaders, 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text'},
          body: JSON.stringify({input: body.query.trim(), languageCode: language,
            regionCode: 'IT', sessionToken: session}),
        };
      } else {
        if (!validPlaceId(body.place_id)) return reply(400, {error: 'invalid_place_id'});
        const params = new URLSearchParams({languageCode: language, regionCode: 'IT'});
        if (session) params.set('sessionToken', session);
        url = `https://places.googleapis.com/v1/places/${encodeURIComponent(body.place_id)}?${params}`;
        // Essentials fields only: never request displayName, ratings or photos.
        init = {headers: {...googleHeaders, 'X-Goog-FieldMask': 'id,formattedAddress,location,attributions'}};
      }
      if (!await deps.consume(userId)) return reply(429, {error: 'places_rate_limit'});
      const upstream = await (deps.fetcher ?? fetch)(url, {...init, signal: AbortSignal.timeout(8000)});
      if (!upstream.ok) {
        // Do not forward Google errors, request bodies or credentials to the client/logs.
        return reply(upstream.status === 404 ? 404 : 503, {error: 'places_unavailable'});
      }
      const data = await upstream.json();
      if (action === 'autocomplete') {
        return reply(200, {suggestions: (data.suggestions ?? [])
          .map((item: any) => item.placePrediction)
          .filter((item: any) => validPlaceId(item?.placeId) && typeof item?.text?.text === 'string')
          .slice(0, 5)
          .map((item: any) => ({place_id: item.placeId, label: item.text.text}))});
      }
      if (typeof data.formattedAddress !== 'string' || !data.formattedAddress.trim()) {
        return reply(404, {error: 'places_unavailable'});
      }
      return reply(200, {place_id: data.id || body.place_id,
        address: data.formattedAddress, latitude: data.location?.latitude,
        longitude: data.location?.longitude,
        attributions: (data.attributions ?? []).map((a: any) => ({
          provider: String(a.provider ?? ''), uri: /^https:\/\//.test(a.providerUri) ? a.providerUri : null,
        }))});
    } catch {
      return reply(503, {error: 'places_unavailable'});
    }
  };
}
