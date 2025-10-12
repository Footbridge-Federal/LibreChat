import { ThemeSelector } from '@librechat/client';
import { TStartupConfig } from 'librechat-data-provider';
import { ErrorMessage } from '~/components/Auth/ErrorMessage';
import { TranslationKeys, useLocalize } from '~/hooks';
import SocialLoginRender from './SocialLoginRender';
import { BlinkAnimation } from './BlinkAnimation';
import { Banner } from '../Banners';
import Footer from './Footer';

function AuthLayout({
  children,
  header,
  isFetching,
  startupConfig,
  startupConfigError,
  pathname,
  error,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
  isFetching: boolean;
  startupConfig: TStartupConfig | null | undefined;
  startupConfigError: unknown | null | undefined;
  pathname: string;
  error: TranslationKeys | null;
}) {
  const localize = useLocalize();

  const hasStartupConfigError = startupConfigError !== null && startupConfigError !== undefined;
  const DisplayError = () => {
    if (hasStartupConfigError) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize('com_auth_error_login_server')}</ErrorMessage>
        </div>
      );
    } else if (error === 'com_auth_error_invalid_reset_token') {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>
            {localize('com_auth_error_invalid_reset_token')}{' '}
            <a className="font-semibold text-cyan-600 hover:underline" href="/forgot-password">
              {localize('com_auth_click_here')}
            </a>{' '}
            {localize('com_auth_to_try_again')}
          </ErrorMessage>
        </div>
      );
    } else if (error != null && error) {
      return (
        <div className="mx-auto sm:max-w-sm">
          <ErrorMessage>{localize(error)}</ErrorMessage>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-white dark:bg-gray-900">
      <Banner />
      <DisplayError />
      <div className="absolute bottom-0 left-0 md:m-4 z-50">
        <ThemeSelector />
      </div>

      <div className="flex flex-grow items-center justify-center px-6">
        <BlinkAnimation active={isFetching}>
          <div className="relative p-8 rounded-2xl bg-gradient-to-r from-blue-600/10 to-blue-800/10 backdrop-blur-sm border border-white/10 shadow-lg hover:shadow-xl hover:bg-gradient-to-r hover:from-blue-500/15 hover:to-blue-700/15 hover:scale-102 transition-all duration-300 transform flex flex-col items-center cursor-pointer w-full max-w-md">
            {/* Logo */}
            <div className="mb-4">
              <img
                src="/assets/logo.svg"
                className="h-12 w-auto opacity-90"
                alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'Airwall.Chat' })}
              />
            </div>
            
            {/* App Title */}
            <div className="text-xl font-light text-gray-700 dark:text-gray-200 tracking-wide text-center">
              {startupConfig?.appTitle ?? 'Welcome to Airwall.Chat'}
            </div>
            
            {/* Underline decoration */}
            <div className="mt-2 h-0.5 w-full bg-gradient-to-r from-transparent via-blue-600/40 to-transparent"></div>
            
            {/* Welcome text below underline */}
            {!hasStartupConfigError && !isFetching && (
              <div className="mt-6 text-center">
                <h1
                  className="text-2xl font-light text-gray-600 dark:text-gray-300 tracking-wide"
                  style={{ userSelect: 'none' }}
                >
                  {header}
                </h1>
              </div>
            )}
            
            {/* Form content */}
            <div className="mt-6 w-full">
              {children}
              {!pathname.includes('2fa') &&
                (pathname.includes('login') || pathname.includes('register')) && (
                  <SocialLoginRender startupConfig={startupConfig} />
                )}
            </div>
          </div>
        </BlinkAnimation>
      </div>
      <Footer startupConfig={startupConfig} />
    </div>
  );
}

export default AuthLayout;
