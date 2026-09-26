// Vercel function: OAuth discovery documents, reached through rewrites in vercel.json:
//   /.well-known/oauth-protected-resource[/api/account-mcp]  (RFC 9728)
//   /.well-known/oauth-authorization-server                   (RFC 8414)
import { json, preflight, originOf } from '../../mcp/http.js';

export function GET(request) {
  const origin = originOf(request);
  const type = new URL(request.url).searchParams.get('type');
  const cache = { 'Cache-Control': 'public, max-age=3600' };
  if (type === 'resource') {
    return json({
      resource: `${origin}/api/account-mcp`,
      authorization_servers: [origin],
      scopes_supported: ['documents'],
      bearer_methods_supported: ['header'],
      resource_name: 'Hashlite documents',
      resource_documentation: `${origin}/connect`,
    }, 200, cache);
  }
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    scopes_supported: ['documents'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    service_documentation: `${origin}/connect`,
  }, 200, cache);
}

export const OPTIONS = preflight;
