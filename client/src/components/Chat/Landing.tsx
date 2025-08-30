import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { easings } from '@react-spring/web';
import { EModelEndpoint } from 'librechat-data-provider';
import { /* BirthdayIcon, TooltipAnchor, */ SplitText } from '@librechat/client';
import { useChatContext, useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import ConvoIcon from '~/components/Endpoints/ConvoIcon';
import { useLocalize, useAuthContext } from '~/hooks';
import { getIconEndpoint, getEntity } from '~/utils';

const containerClassName =
  'shadow-stroke relative flex h-full items-center justify-center rounded-full bg-white dark:bg-presentation dark:text-white text-black dark:after:shadow-none ';

function getTextSizeClass(text: string | undefined | null) {
  if (!text) {
    return 'text-xl sm:text-2xl';
  }

  if (text.length < 40) {
    return 'text-2xl sm:text-4xl';
  }

  if (text.length < 70) {
    return 'text-xl sm:text-2xl';
  }

  return 'text-lg sm:text-md';
}

export default function Landing({ centerFormOnLanding }: { centerFormOnLanding: boolean }) {
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const assistantMap = useAssistantsMapContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { user } = useAuthContext();
  const localize = useLocalize();

  const [textHasMultipleLines, setTextHasMultipleLines] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const endpointType = useMemo(() => {
    let ep = conversation?.endpoint ?? '';
    if (
      [
        EModelEndpoint.chatGPTBrowser,
        EModelEndpoint.azureOpenAI,
        EModelEndpoint.gptPlugins,
      ].includes(ep as EModelEndpoint)
    ) {
      ep = EModelEndpoint.openAI;
    }
    return getIconEndpoint({
      endpointsConfig,
      iconURL: conversation?.iconURL,
      endpoint: ep,
    });
  }, [conversation?.endpoint, conversation?.iconURL, endpointsConfig]);

  const { entity, isAgent, isAssistant } = getEntity({
    endpoint: endpointType,
    agentsMap,
    assistantMap,
    agent_id: conversation?.agent_id,
    assistant_id: conversation?.assistant_id,
  });

  const name = entity?.name ?? '';
  const description = (entity?.description || conversation?.greeting) ?? '';

  // Simplified greeting - just use custom welcome or default
  const getGreeting = useCallback(() => {
    if (typeof startupConfig?.interface?.customWelcome === 'string') {
      const customWelcome = startupConfig.interface.customWelcome;
      // Replace {{user.name}} with actual user name if available
      if (user?.name && customWelcome.includes('{{user.name}}')) {
        return customWelcome.replace(/{{user.name}}/g, user.name);
      }
      return customWelcome;
    }

    // Simple default welcome message
    return 'Welcome to Airwall.Chat';

    // COMMENTED OUT: Complex time-based greeting logic
    // const now = new Date();
    // const hours = now.getHours();
    // const dayOfWeek = now.getDay();
    // const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    // 
    // // Early morning (midnight to 4:59 AM)
    // if (hours >= 0 && hours < 5) {
    //   return localize('com_ui_late_night');
    // }
    // // Morning (6 AM to 11:59 AM)
    // else if (hours < 12) {
    //   if (isWeekend) {
    //     return localize('com_ui_weekend_morning');
    //   }
    //   return localize('com_ui_good_morning');
    // }
    // // Afternoon (12 PM to 4:59 PM)
    // else if (hours < 17) {
    //   return localize('com_ui_good_afternoon');
    // }
    // // Evening (5 PM to 8:59 PM)
    // else {
    //   return localize('com_ui_good_evening');
    // }
  }, [startupConfig?.interface?.customWelcome, user?.name]);

  const handleLineCountChange = useCallback((count: number) => {
    setTextHasMultipleLines(count > 1);
    setLineCount(count);
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.offsetHeight);
    }
  }, [lineCount, description]);

  const getDynamicMargin = useMemo(() => {
    let margin = 'mb-0';

    if (lineCount > 2 || (description && description.length > 100)) {
      margin = 'mb-10';
    } else if (lineCount > 1 || (description && description.length > 0)) {
      margin = 'mb-6';
    } else if (textHasMultipleLines) {
      margin = 'mb-4';
    }

    if (contentHeight > 200) {
      margin = 'mb-16';
    } else if (contentHeight > 150) {
      margin = 'mb-12';
    }

    return margin;
  }, [lineCount, description, textHasMultipleLines, contentHeight]);

  const greetingText = getGreeting();

  // Only show landing content when there's no conversation or it's a new conversation
  const showLanding = !conversation?.conversationId || conversation?.conversationId === 'new';

  if (!showLanding) {
    return null;
  }

  return (
    <>
      {/* TOP SECTION: Logo + Welcome message */}
      <div className="flex flex-col items-center pt-8 mb-40 pointer-events-none">
        {/* Airwall Logo - disappears last (smallest space) */}
        <div className="mb-4 hidden sm:block">
          <img 
            src="/assets/logo.svg" 
            alt="Airwall Logo" 
            className="h-16 w-auto dark:filter dark:invert opacity-90"
          />
        </div>
        {/* Welcome message - disappears first (needs most space) */}
        <div className="hidden lg:block">
          <SplitText
            key="welcome-airwall"
            text="Welcome to Airwall.Chat"
            className="text-2xl sm:text-3xl font-medium text-text-primary"
            delay={50}
            textAlign="center"
            animationFrom={{ opacity: 0, transform: 'translate3d(0,50px,0)' }}
            animationTo={{ opacity: 1, transform: 'translate3d(0,0,0)' }}
            easing={easings.easeOutCubic}
            threshold={0}
            rootMargin="0px"
          />
        </div>
      </div>

      {/* CENTER SECTION: "How can I help?" - positioned right above chat form */}
      <div className="flex items-center justify-center mb-2 pointer-events-none">
        <div ref={contentRef} className="flex flex-col items-center gap-0 p-2">
          {((isAgent || isAssistant) && name) || name ? (
            <div className="flex flex-col items-center gap-0 p-2">
              <SplitText
                key={`split-text-${name}`}
                text={name}
                className={`${getTextSizeClass(name)} font-medium text-text-primary`}
                delay={50}
                textAlign="center"
                animationFrom={{ opacity: 0, transform: 'translate3d(0,50px,0)' }}
                animationTo={{ opacity: 1, transform: 'translate3d(0,0,0)' }}
                easing={easings.easeOutCubic}
                threshold={0}
                rootMargin="0px"
                onLineCountChange={handleLineCountChange}
              />
            </div>
          ) : (
            <SplitText
              key="help-text"
              text="How can I help?"
              className="text-2xl sm:text-3xl font-medium text-text-primary"
              delay={150}
              textAlign="center"
              animationFrom={{ opacity: 0, transform: 'translate3d(0,50px,0)' }}
              animationTo={{ opacity: 1, transform: 'translate3d(0,0,0)' }}
              easing={easings.easeOutCubic}
              threshold={0}
              rootMargin="0px"
              onLineCountChange={handleLineCountChange}
            />
          )}
          {description && (
            <div className="animate-fadeIn mt-4 max-w-md text-center text-sm font-normal text-text-primary">
              {description}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
