/**
 * home actions overlay
 */
import React, { Component } from 'react';
import { View, Text, InteractionManager } from 'react-native';

import { OptionsModalPresentationStyle, OptionsModalTransitionStyle } from 'react-native-navigation';

import { Navigator } from '@common/helpers/navigator';

import { AccountRepository } from '@store/repositories';
import { AccountSchema } from '@store/schemas/latest';

import { BackendService } from '@services';

import { AppScreens } from '@common/constants';

import { XAppOrigin } from '@common/libs/payload';

// components
import { Button, ActionPanel, Spacer } from '@components/General';
import { XAppShortList } from '@components/Modules';

import Localize from '@locale';

// style
import { AppStyles, AppSizes } from '@theme';
import styles from './styles';

/* types ==================================================================== */
export interface Props {}

export interface State {
    account: AccountSchema;
    apps: any;
    featured: any;
}

/* Component ==================================================================== */
class HomeActionsOverlay extends Component<Props, State> {
    static screenName = AppScreens.Overlay.HomeActions;

    private actionPanel: React.RefObject<ActionPanel>;
    private mounted: boolean;

    static options() {
        return {
            statusBar: {
                visible: true,
                style: 'light',
            },
            topBar: {
                visible: false,
            },
        };
    }

    constructor(props: Props) {
        super(props);

        this.state = {
            account: AccountRepository.getDefaultAccount(),
            apps: undefined,
            featured: undefined,
        };

        this.actionPanel = React.createRef();
    }

    componentDidMount() {
        // keep track of component mounted statue
        this.mounted = true;

        // fetch the apps short list
        InteractionManager.runAfterInteractions(this.fetchApps);
    }

    componentWillUnmount() {
        // keep track of component mounted statue
        this.mounted = false;
    }

    fetchApps = () => {
        BackendService.getXAppShortList().then((resp: any) => {
            const { apps, featured } = resp;

            if (!this.mounted) {
                return;
            }

            this.setState({
                apps,
                featured,
            });
        });
    };

    onScanButtonPress = () => {
        if (this.actionPanel.current) {
            this.actionPanel.current.slideDown();
        }

        setTimeout(() => {
            Navigator.showModal(
                AppScreens.Modal.Scan,
                {},
                {
                    modalTransitionStyle: OptionsModalTransitionStyle.coverVertical,
                    modalPresentationStyle: OptionsModalPresentationStyle.fullScreen,
                },
            );
        }, 800);
    };

    onAppPress = (app: any) => {
        const { account } = this.state;
        const { identifier, title, icon } = app;

        if (this.actionPanel.current) {
            this.actionPanel.current.slideDown();
        }

        setTimeout(() => {
            Navigator.showModal(
                AppScreens.Modal.XAppBrowser,
                {
                    identifier,
                    title,
                    icon,
                    account,
                    origin: XAppOrigin.XAPP_SHORT_LIST,
                },
                {
                    modalTransitionStyle: OptionsModalTransitionStyle.coverVertical,
                    modalPresentationStyle: OptionsModalPresentationStyle.fullScreen,
                },
            );
        }, 800);
    };

    render() {
        const { apps, featured } = this.state;

        return (
            <ActionPanel
                height={AppSizes.moderateScale(440)}
                onSlideDown={Navigator.dismissOverlay}
                extraBottomInset
                ref={this.actionPanel}
            >
                <Text numberOfLines={1} style={[styles.rowTitle, styles.rowTitleFirst]}>
                    {Localize.t('xapp.recentlyUsed')}
                </Text>
                <XAppShortList apps={apps} onAppPress={this.onAppPress} />

                <Spacer size={15} />

                <Text numberOfLines={1} style={styles.rowTitle}>
                    {Localize.t('xapp.ourSuggestions')}
                </Text>
                <XAppShortList apps={featured} onAppPress={this.onAppPress} />

                <View style={styles.actionButtonContainer}>
                    <Button
                        contrast
                        numberOfLines={1}
                        label={Localize.t('global.scanAQRCode')}
                        onPress={this.onScanButtonPress}
                        icon="IconScan"
                        style={AppStyles.flex1}
                    />
                </View>
            </ActionPanel>
        );
    }
}

/* Export Component ==================================================================== */
export default HomeActionsOverlay;
