<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
    <#if section = "header">
        <div class="airwall-header">
            <img src="${url.resourcesPath}/img/logo.svg" alt="Airwall" class="airwall-logo">
            <div class="airwall-app-title">Airwall.Chat</div>
            <div class="airwall-divider-line"></div>
            <h1 class="airwall-welcome-title">Welcome back</h1>
        </div>
    <#elseif section = "form">
        <div id="kc-form">
            <div id="kc-form-wrapper">
                <#if realm.password>
                    <form id="kc-form-login" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
                        <div class="airwall-form-group">
                            <#if usernameEditDisabled??>
                                <input tabindex="1" id="username" class="airwall-input" name="username" value="${(login.username!'')}" type="text" disabled placeholder="<#if !realm.loginWithEmailAllowed>${msg('username')}<#elseif !realm.registrationEmailAsUsername>${msg('usernameOrEmail')}<#else>${msg('email')}</#if>" />
                            <#else>
                                <input tabindex="1" id="username" class="airwall-input" name="username" value="${(login.username!'')}"  type="text" autofocus autocomplete="off" placeholder="<#if !realm.loginWithEmailAllowed>${msg('username')}<#elseif !realm.registrationEmailAsUsername>${msg('usernameOrEmail')}<#else>${msg('email')}</#if>"
                                       aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                                />
                            </#if>

                            <#if messagesPerField.existsError('username','password')>
                                <span id="input-error-username-password" class="airwall-error" aria-live="polite">
                                    ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                                </span>
                            </#if>
                        </div>

                        <div class="airwall-form-group">
                            <input tabindex="2" id="password" class="airwall-input" name="password" type="password" autocomplete="off" placeholder="${msg('password')}"
                                   aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                            />
                        </div>

                        <div class="airwall-form-actions">
                            <#if realm.rememberMe && !usernameEditDisabled??>
                                <div class="airwall-checkbox">
                                    <input tabindex="3" id="rememberMe" name="rememberMe" type="checkbox" <#if login.rememberMe??>checked</#if>>
                                    <label for="rememberMe">${msg("rememberMe")}</label>
                                </div>
                            </#if>

                            <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>

                            <button tabindex="4" class="airwall-button-primary" name="login" id="kc-login" type="submit">
                                ${msg("doLogIn")}
                            </button>
                        </div>
                    </form>
                </#if>

                <#if realm.password && social.providers??>
                    <div class="airwall-social-section">
                        <div class="airwall-divider">
                            <span>or</span>
                        </div>

                        <#list social.providers as p>
                            <a id="social-${p.alias}" class="airwall-social-button" type="button" href="${p.loginUrl}">
                                <#if p.iconClasses?has_content>
                                    <i class="${properties.kcCommonLogoIdP!} ${p.iconClasses!}" aria-hidden="true"></i>
                                    <span class="${properties.kcFormSocialAccountNameClass!} kc-social-icon-text">${p.displayName!}</span>
                                <#else>
                                    <span class="${properties.kcFormSocialAccountNameClass!}">${p.displayName!}</span>
                                </#if>
                            </a>
                        </#list>
                    </div>
                </#if>
            </div>
        </div>
    <#elseif section = "info" >
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <div class="airwall-info">
                <span>
                    ${msg("noAccount")}
                    <a tabindex="6" href="${url.registrationUrl}">${msg("doRegister")}</a>
                </span>
            </div>
        </#if>

        <#if realm.password && realm.resetPasswordAllowed>
            <div class="airwall-info">
                <a tabindex="5" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>