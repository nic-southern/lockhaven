# Single sign-on

Lockhaven signs people in through the company identity provider at
`https://auth.newmarketsecurity.com` (realm `nms`, client `lockhaven`).
OIDC is the default. SAML uses the same organization settings. Directory
sync (SCIM) is not included; when someone leaves, disable the account in
the Console and in the identity provider.

## Host environment

Set these on the droplet in `.env.deploy`. Do not commit client secrets.

```text
SSO_OIDC_ISSUER=https://auth.newmarketsecurity.com/realms/nms
SSO_OIDC_DISCOVERY_URL=https://auth.newmarketsecurity.com/realms/nms/.well-known/openid-configuration
SSO_OIDC_CLIENT_ID=lockhaven
SSO_OIDC_CLIENT_SECRET=replace_me
SSO_OIDC_PROVIDER_ID=lockhaven
SSO_ALLOWED_DOMAINS=example.com
SSO_CLAIMS_MAP={"claim":"groups","values":{"operators":{"organizationRole":"operator"},"technicians":{"organizationRole":"technician"}}}
SSO_DEFAULT_ORGANIZATION_ID=
SSO_REQUIRED=false
SSO_TRUST_IDP_MFA=false
```

Optional SAML for a company provider:

```text
SSO_SAML_PROVIDER_ID=sso-saml
SSO_SAML_ENTRY_POINT=
SSO_SAML_CERT=
SSO_SAML_AUDIENCE=
SSO_SAML_METADATA_XML=
```

`PRODUCT_NAME` is unchanged and still names the Console.

SSO stays off until `SSO_OIDC_CLIENT_SECRET` is a real secret (not
`replace_me`).

## Identity provider client

Redirect URIs for the `lockhaven` client:

- `{APP_BASE_URL}/api/auth/oauth2/callback/lockhaven`
- `{APP_BASE_URL}/api/auth/callback/lockhaven`
- `{APP_BASE_URL}/api/auth/oauth2/callback/sso` (legacy provider id)
- `{APP_BASE_URL}/api/auth/callback/sso`

SAML assertion consumer URL, when an organization uses its own provider:

- `{APP_BASE_URL}/api/auth/sso/saml2/callback/org-<organization-id>`

## Behavior

- New people are created as platform members. Organization and site roles
  come from the claims map or the organization's default role.
- Existing local accounts with a matching verified email are linked.
- Domain allowlists apply to new sign-ins. With an empty allowlist, only
  existing accounts can sign in through SSO.
- Sign in with SSO starts the company identity provider immediately. It
  does not ask for email first.
- Password, passkey, and existing sessions stay available while SSO is
  optional. Require SSO is off by default. Enrollment still uses Hub
  credentials.
- When SSO is required for a matching domain, passwords and passkeys are
  blocked. If the identity provider is down and SSO is required, sign-in
  stays closed. If SSO is not required, password sign-in still works.
- Console admins can trust the identity provider and skip the in-app
  authenticator step.

## Offboarding

SCIM is deferred. Remove access in both places: suspend or delete the
Console user, and disable the person in the identity provider.
