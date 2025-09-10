import React, { useMemo, memo } from 'react';
import type { Assistant, Agent } from 'librechat-data-provider';
import type { TMessageIcon } from '~/common';
import { getEndpointField, getIconEndpoint, logger } from '~/utils';
import ConvoIconURL from '~/components/Endpoints/ConvoIconURL';
import { useGetEndpointsQuery } from '~/data-provider';
import Icon from '~/components/Endpoints/Icon';

const MessageIcon = memo(
  ({
    iconData,
    assistant,
    agent,
  }: {
    iconData?: TMessageIcon;
    assistant?: Assistant;
    agent?: Agent;
  }) => {
    logger.log('icon_data', iconData, assistant, agent);
    const { data: endpointsConfig } = useGetEndpointsQuery();

    const agentName = useMemo(() => agent?.name ?? '', [agent]);
    const agentAvatar = useMemo(() => agent?.avatar?.filepath ?? '', [agent]);
    const assistantName = useMemo(() => assistant?.name ?? '', [assistant]);
    const assistantAvatar = useMemo(() => assistant?.metadata?.avatar ?? '', [assistant]);

    const avatarURL = useMemo(() => {
      let result = '';
      if (assistant) {
        result = assistantAvatar;
      } else if (agent) {
        result = agentAvatar;
      }
      return result;
    }, [assistant, agent, assistantAvatar, agentAvatar]);

    const iconURL = iconData?.iconURL;
    const endpoint = useMemo(
      () => getIconEndpoint({ endpointsConfig, iconURL, endpoint: iconData?.endpoint }),
      [endpointsConfig, iconURL, iconData?.endpoint],
    );

    const endpointIconURL = useMemo(
      () => getEndpointField(endpointsConfig, endpoint, 'iconURL'),
      [endpointsConfig, endpoint],
    );

    // For non-user messages, always show Airwall logo
    if (iconData?.isCreatedByUser !== true) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <img 
            src="/assets/logo.svg" 
            alt="Airwall.Chat" 
            className="h-6 w-6"
            style={{ minWidth: '24px', minHeight: '24px' }}
          />
        </div>
      );
    }

    // For user messages, show user avatar
    return (
      <Icon
        isCreatedByUser={iconData?.isCreatedByUser ?? false}
        endpoint={endpoint}
        iconURL={avatarURL || endpointIconURL}
        model={iconData?.model}
        assistantName={assistantName}
        agentName={agentName}
        size={24}
      />
    );
  },
);

MessageIcon.displayName = 'MessageIcon';

export default MessageIcon;
