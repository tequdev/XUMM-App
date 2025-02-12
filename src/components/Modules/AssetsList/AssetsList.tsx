import React, { Component } from 'react';
import { ViewStyle } from 'react-native';
import { AccountSchema } from '@store/schemas/latest';

import { Navigator } from '@common/helpers/navigator';
import { AppScreens } from '@common/constants';

import { TokensList } from './Tokens';
import { NFTokensList } from './NFTokens';
/* Types ==================================================================== */
export enum ASSETS_CATEGORY {
    Tokens = 'Tokens',
    NFTokens = 'NFTokens',
}

interface Props {
    timestamp?: number;
    style: ViewStyle | ViewStyle[];
    account: AccountSchema;
    discreetMode: boolean;
    spendable: boolean;
}

interface State {
    account: string;
    category: ASSETS_CATEGORY;
}

/* Component ==================================================================== */
class AssetsList extends Component<Props, State> {
    constructor(props: Props) {
        super(props);

        this.state = {
            account: props.account?.address,
            category: ASSETS_CATEGORY.Tokens,
        };
    }

    static getDerivedStateFromProps(nextProps: Props, prevState: State) {
        if (nextProps.account?.address !== prevState.account) {
            return {
                category: ASSETS_CATEGORY.Tokens,
                account: nextProps.account?.address,
            };
        }
        return null;
    }

    onAssetCategoryChange = (selectedCategory: ASSETS_CATEGORY) => {
        const { category } = this.state;

        if (selectedCategory !== category) {
            this.setState({
                category: selectedCategory,
            });
        }
    };

    onChangeCategoryPress = () => {
        const { category } = this.state;

        Navigator.showOverlay(AppScreens.Overlay.SwitchAssetCategory, {
            selected: category,
            onSelect: this.onAssetCategoryChange,
        });
    };

    render() {
        const { style, timestamp, discreetMode, spendable, account } = this.props;
        const { category } = this.state;

        let AssetListComponent;

        switch (category) {
            case ASSETS_CATEGORY.Tokens:
                AssetListComponent = TokensList;
                break;
            case ASSETS_CATEGORY.NFTokens:
                AssetListComponent = NFTokensList;
                break;
            default:
                return null;
        }

        return (
            <AssetListComponent
                key={`${AssetListComponent.name}_${timestamp}`}
                account={account}
                discreetMode={discreetMode}
                spendable={spendable}
                onChangeCategoryPress={this.onChangeCategoryPress}
                style={style}
            />
        );
    }
}

export default AssetsList;
