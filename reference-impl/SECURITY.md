# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

We take the security of AITuber Protocol seriously. If you believe you have found a security vulnerability, please report it to us.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via:

1. **GitHub Security Advisories** (Recommended)
   - Use the [Security Advisories](https://github.com/YOUR_REPO/security/advisories) feature
   - Select "Report a vulnerability"

2. **Email** (Alternative)
   - Send details to: security@example.com
   - Use subject: "[SECURITY] AITuber Protocol Vulnerability"

### What to Include

Please include the following information:

- Description of the vulnerability
- Steps to reproduce or proof-of-concept
- Affected versions
- Potential impact
- Any suggested mitigations

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution**: Depends on severity (typically 14-30 days)

### Security Best Practices

When using this implementation:

1. **Key Management**
   - Never commit private keys to version control
   - Use environment variables or secure key storage
   - Rotate keys regularly

2. **Transport Security**
   - Always use HTTPS for API endpoints
   - Verify TLS certificates
   - Implement proper certificate pinning where appropriate

3. **Session Management**
   - Implement proper session timeout
   - Validate session tokens on each request
   - Use secure cookie settings (HttpOnly, Secure, SameSite)

4. **Input Validation**
   - Validate all external inputs
   - Sanitize user-provided content
   - Use parameterized queries for database operations

5. **Cryptographic Operations**
   - Use Ed25519 for signatures
   - Never roll your own crypto
   - Keep cryptographic libraries updated

## Known Security Considerations

### Ed25519 Implementation
- This implementation uses `@noble/ed25519` for cryptographic operations
- Ensure you're using a supported version of the library
- Key generation should use cryptographically secure random sources

### Session Tokens
- Session tokens should be treated as sensitive data
- Implement proper token expiration and rotation
- Consider token binding to prevent theft

### Cross-Origin Requests
- Implement proper CORS policies
- Use CSRF tokens for state-changing operations
- Consider SameSite cookie attribute

## Security Features

This implementation includes:

- Ed25519 digital signatures for authentication
- Challenge-response authentication flow
- Session epoch tracking for rollback detection
- Identity version control for key rotation
- Quarantine mechanism for compromised agents
- Revocation epoch tracking

## Attribution

We appreciate responsible disclosure of security vulnerabilities. Security researchers who report vulnerabilities responsibly will be acknowledged (with permission).