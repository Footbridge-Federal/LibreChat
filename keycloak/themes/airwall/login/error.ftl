<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        <div class="airwall-header">
            <h1>Airwall.Chat</h1>
            <p class="airwall-subtitle">Something went wrong</p>
        </div>
    <#elseif section = "form">
        <div class="alert alert-error">
            <#if message?has_content>
                ${kcSanitize(message.summary)?no_esc}
            <#else>
                ${msg("errorTitle")}
            </#if>
        </div>
        <div class="airwall-form-actions">
            <a href="${url.loginUrl}" class="airwall-button-primary" style="display: inline-flex; align-items: center; justify-content: center; text-decoration: none;">
                ${msg("backToLogin")?no_esc}
            </a>
        </div>
    </#if>
</@layout.registrationLayout>