<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html lang="en-US">
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <meta name="theme-color" content="#171717" />

    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>

    <title>Airwall.Chat</title>
    <link rel="icon" href="${url.resourcesPath}/img/favicon.ico" />

    <#if properties.stylesCommon?has_content>
        <#list properties.stylesCommon?split(' ') as style>
            <link href="${url.resourcesCommonPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.scripts?has_content>
        <#list properties.scripts?split(' ') as script>
            <script src="${url.resourcesPath}/${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>

    <style>
        /* LibreChat-inspired styling */
        :root {
            --white: #fff;
            --gray-50: #f7f7f8;
            --gray-100: #ececec;
            --gray-200: #e3e3e3;
            --gray-300: #cdcdcd;
            --gray-600: #424242;
            --gray-700: #2f2f2f;
            --gray-800: #212121;
            --gray-850: #171717;
            --green-600: #059669;
            --green-700: #047857;
            --green-800: #065f46;
            --brand-purple: #ab68ff;
        }

        body {
            margin: 0;
            padding: 0;
            background: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .airwall-container {
            width: 100%;
            max-width: 448px;
            margin: 0 auto;
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            justify-content: center;
        }

        .airwall-card {
            background: linear-gradient(to right, rgba(37, 99, 235, 0.1), rgba(30, 64, 175, 0.1));
            backdrop-filter: blur(4px);
            border-radius: 1rem;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 2rem;
            width: 100%;
            box-sizing: border-box;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .airwall-card:hover {
            background: linear-gradient(to right, rgba(59, 130, 246, 0.15), rgba(29, 78, 216, 0.15));
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
        }

        .airwall-header {
            text-align: center;
            margin-bottom: 1.5rem;
        }

        .airwall-welcome-title {
            font-size: 1.7rem !important;
        }

        .airwall-app-title {
            font-size: 1.75rem;
            font-weight: 300;
            color: #374151;
            margin: 0 0 0.5rem 0;
            letter-spacing: 0.05em;
        }

        .airwall-divider-line {
            margin: 0.5rem 0 .7rem 0;
            height: 2px;
            background: linear-gradient(to right, transparent, rgba(37, 99, 235, 0.4), transparent);
        }

        .airwall-logo {
            height: 3rem;
            width: auto;
            opacity: 0.9;
            margin-bottom: 1rem;
        }

        .airwall-header h1 {
            font-size: 2rem;
            font-weight: 300;
            color: #4b5563;
            margin: 0;
            letter-spacing: 0.05em;
            user-select: none;
        }

        .airwall-form-group {
            margin-bottom: 1.5rem;
        }

        .airwall-form-group {
            margin-bottom: 1.5rem;
        }

        .airwall-input {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 1px solid #d1d5db;
            border-radius: 1rem;
            background: white;
            color: #111827;
            font-size: 1rem;
            transition: border-color 0.2s ease-in-out;
            box-sizing: border-box;
        }

        .airwall-input:focus {
            outline: none;
            border-color: #06b6d4;
        }

        .airwall-input::placeholder {
            color: #9ca3af;
            opacity: 1;
        }

        .airwall-button-primary {
            width: 100%;
            padding: 0.75rem 1.5rem;
            background: #2563eb;
            color: white;
            font-size: 1rem;
            font-weight: 600;
            border-radius: 1rem;
            border: none;
            cursor: pointer;
            transition: background-color 0.2s ease-in-out;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 48px;
        }

        .airwall-button-primary:hover {
            background: #1d4ed8;
        }

        .airwall-button-primary:active {
            background: #1e40af;
        }

        .airwall-social-section {
            margin-top: 1.5rem;
        }

        .airwall-divider {
            text-align: center;
            margin: 1.5rem 0;
            position: relative;
        }

        .airwall-divider::before {
            content: '';
            position: absolute;
            top: 50%;
            left: 0;
            right: 0;
            height: 1px;
            background: #d1d5db;
            z-index: 1;
        }

        .airwall-divider span {
            background: white;
            padding: 0 1rem;
            color: #6b7280;
            font-size: 0.875rem;
            position: relative;
            z-index: 2;
        }

        .airwall-social-button {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            padding: 0.75rem 1.5rem;
            margin-bottom: 0.75rem;
            border: 1px solid var(--gray-300);
            border-radius: 1rem;
            background: var(--white);
            color: var(--gray-700);
            text-decoration: none;
            font-size: 1rem;
            font-weight: 500;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            min-height: 48px;
            box-sizing: border-box;
        }

        .airwall-social-section {
            width: 100%;
        }

        .airwall-social-button:hover {
            background: var(--gray-50);
            border-color: var(--gray-400);
            text-decoration: none;
        }

        .airwall-social-button:active {
            background: var(--gray-100);
        }

        /* Fix social button text alignment */
        .airwall-social-button span {
            flex: 1;
            text-align: center;
            width: 100%;
            display: block;
        }

        /* Microsoft specific styling */
        .airwall-social-button[href*="microsoft"] {
            background: #0078d4;
            color: white;
            border-color: #0078d4;
            font-weight: 600;
        }

        .airwall-social-button[href*="microsoft"]:hover {
            background: #106ebe;
            border-color: #106ebe;
            color: white;
        }

        .airwall-checkbox {
            display: flex;
            align-items: center;
            margin-bottom: 1rem;
        }

        .airwall-checkbox input {
            margin-right: 0.5rem;
        }

        .airwall-checkbox label {
            font-size: 0.875rem;
            color: var(--gray-600);
            margin: 0;
        }

        .airwall-error {
            color: #dc2626;
            font-size: 0.875rem;
            margin-top: 0.25rem;
            display: block;
        }

        .airwall-info {
            text-align: center;
            margin-top: 1rem;
            font-size: 0.875rem;
            color: var(--gray-600);
        }

        .airwall-info a {
            color: #06b6d4;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.2s ease-in-out;
        }

        .airwall-info a:hover {
            text-decoration: underline;
            color: #0891b2;
        }

        .airwall-info {
            text-align: center;\n            margin-top: 1rem;\n            font-size: 0.875rem;\n            color: #6b7280;\n        }

        .airwall-form-actions {
            margin-top: 1.5rem;
        }

        /* Form container width fixes */
        #kc-form,
        #kc-form-wrapper {
            width: 100%;
            max-width: none;
        }

        .airwall-social-section {
            width: 100%;
        }

        /* Ensure form content takes full width */
        .airwall-card form {
            width: 100%;
        }

        /* Alert styling */
        .alert {
            padding: 0.75rem 1rem;
            border-radius: 0.5rem;
            margin-bottom: 1rem;
            font-size: 0.875rem;
        }

        .alert-error {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #991b1b;
        }

        .alert-success {
            background: #ecfdf5;
            border: 1px solid #a7f3d0;
            color: #047857;
        }

        .alert-info {
            background: #eff6ff;
            border: 1px solid #93c5fd;
            color: #1d4ed8;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .airwall-container {
                padding: 1rem;
            }

            .airwall-card {
                padding: 1.5rem;
            }
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
            body {
                background: var(--gray-850);
            }

            .airwall-card {
                background: var(--gray-800);
                border-color: var(--gray-600);
            }

            .airwall-header h1 {
                color: var(--white);
            }

            .airwall-subtitle,
            .airwall-label {
                color: var(--gray-300);
            }

            .airwall-input {
                background: var(--gray-700);
                border-color: var(--gray-600);
                color: var(--white);
            }

            .airwall-social-button {
                background: var(--gray-700);
                border-color: var(--gray-600);
                color: var(--gray-300);
            }

            .airwall-social-button:hover {
                background: var(--gray-600);
            }

            .airwall-divider span {
                background: var(--gray-800);
            }
        }
    </style>
</head>

<body>
    <div class="airwall-container">
        <div class="airwall-card">
            <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                <div class="alert alert-${message.type}">
                    <#if message.type = 'success'><span class="${properties.kcFeedbackSuccessIcon!}"></span></#if>
                    <#if message.type = 'warning'><span class="${properties.kcFeedbackWarningIcon!}"></span></#if>
                    <#if message.type = 'error'><span class="${properties.kcFeedbackErrorIcon!}"></span></#if>
                    <#if message.type = 'info'><span class="${properties.kcFeedbackInfoIcon!}"></span></#if>
                    <span class="kc-feedback-text">${kcSanitize(message.summary)?no_esc}</span>
                </div>
            </#if>

            <#nested "header">

            <#nested "form">

            <#nested "info">
        </div>
    </div>
</body>
</html>
</#macro>