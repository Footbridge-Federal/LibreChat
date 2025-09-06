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
      <div className="flex flex-col items-center pt-8 mb-20">
        {/* Beautiful gradient container for logo and welcome message */}
        <div className="relative p-8 rounded-2xl bg-gradient-to-r from-cyan-400/10 to-blue-500/10 backdrop-blur-sm border border-white/10 shadow-lg hover:shadow-xl hover:bg-gradient-to-r hover:from-cyan-300/15 hover:to-blue-400/15 hover:scale-102 transition-all duration-300 transform flex flex-col items-center cursor-pointer">
          
          {/* Airwall Logo - disappears last (smallest space) */}
          <div className="mb-6 hidden sm:block">
            <img 
              src="/assets/logo.svg" 
              alt="Airwall Logo" 
              className="h-16 w-auto opacity-90"
            />
          </div>
          
          {/* Welcome message - disappears first (needs most space) */}
          <div className="hidden lg:block text-center">
            <div className="text-2xl sm:text-3xl font-light text-gray-700 dark:text-gray-200 tracking-wide">
              Welcome to Airwall.Chat
            </div>
            {/* Underline decoration */}
            <div className="mt-3 h-0.5 w-full bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent"></div>
            
            {/* How can I help section */}
            <div ref={contentRef} className="mt-6">
              {((isAgent || isAssistant) && name) || name ? (
                <div className="flex flex-col items-center gap-2">
                  <div className={`${getTextSizeClass(name)} font-light text-gray-600 dark:text-gray-300 text-center`}>
                    {name}
                  </div>
                </div>
              ) : (
                <div className="text-xl sm:text-2xl font-light text-gray-600 dark:text-gray-300 tracking-wide text-center">
                  How can I help?
                </div>
              )}
              {description && (
                <div className="mt-4 max-w-md text-center text-sm font-normal text-gray-600 dark:text-gray-400 mx-auto">
                  {description}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
