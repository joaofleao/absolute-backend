export const authErrorCatalog = {
  'invalid-credentials': {
    'en-US': 'Invalid email or password.',
    'pr-BR': 'Credenciais inválidas.',
  },
  'account-not-found': {
    'en-US': 'Account not found.',
    'pr-BR': 'Conta não encontrada.',
  },
  'password-missing-signup': {
    'en-US': 'Password is required to sign up.',
    'pr-BR': 'Senha é obrigatória para cadastro.',
  },
  'password-missing-signin': {
    'en-US': 'Password is required to sign in.',
    'pr-BR': 'Senha é obrigatória para login.',
  },
  'password-weak': {
    'en-US': 'Password does not meet requirements.',
    'pr-BR': 'Senha não atende aos requisitos.',
  },
  'reset-not-enabled': {
    'en-US': 'Password reset is not enabled.',
    'pr-BR': 'Recuperação de senha não está habilitada.',
  },
  'verify-not-enabled': {
    'en-US': 'Email verification is not enabled.',
    'pr-BR': 'Verificação de email não está habilitada.',
  },
  'new-password-missing': {
    'en-US': 'New password is required to reset.',
    'pr-BR': 'Nova senha é obrigatória para redefinir.',
  },
  'invalid-reset-code': {
    'en-US': 'Invalid verification code.',
    'pr-BR': 'Código de verificação inválido.',
  },
  'flow-invalid': {
    'en-US': 'Missing or invalid authentication flow.',
    'pr-BR': 'Fluxo de autenticação ausente ou inválido.',
  },
  'auth-generic': {
    'en-US': 'Authentication failed.',
    'pr-BR': 'Falha na autenticação.',
  },
} as const

export type AuthErrorCode = keyof typeof authErrorCatalog

export function getAuthErrorMessage(
  code: AuthErrorCode,
  locale: 'en-US' | 'pr-BR' = 'en-US',
): string {
  return authErrorCatalog[code][locale] ?? authErrorCatalog[code]['en-US']
}
