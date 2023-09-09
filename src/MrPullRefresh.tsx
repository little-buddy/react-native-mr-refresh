import React, { memo, type PropsWithChildren, useCallback } from 'react';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  ViewStyle,
} from 'react-native';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  Extrapolate,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';

import {
  FnNull,
  LogFlag,
  PullingRefreshStatus,
  SystemOffset,
} from './constants';
import { MrPullRefreshContext } from './context';
import { PulldownLoading, PullupLoading } from './DefaultLoading';
import { actuallyMove, checkChildren, isPromise, withAnimation } from './utils';
interface MrRefreshWrapperProps {
  onPulldownRefresh?: () => void | Promise<unknown>;
  onPullupRefresh?: () => void | Promise<unknown>;
  pulldownHeight?: number;
  pullupHeight?: number;
  pulldownLoading?: JSX.Element;
  pullupLoading?: JSX.Element;
  containerFactor?: number;
  pullingFactor?: number;
  enablePullup?: boolean;
  style?: ViewStyle;
}

const MrRefreshWrapper: React.FC<PropsWithChildren<MrRefreshWrapperProps>> = ({
  onPulldownRefresh = FnNull,
  onPullupRefresh = FnNull,
  pulldownHeight = 80,
  pullupHeight = 100,
  pulldownLoading = <PulldownLoading />,
  pullupLoading = <PullupLoading />,
  containerFactor = 0.5,
  pullingFactor = 2.2,
  enablePullup = true /* TODO: will re-render */,
  style,
  children,
}) => {
  // custom
  const pulldownState = useSharedValue<PullingRefreshStatus>(
    PullingRefreshStatus.IDLE
  );
  const pullupState = useSharedValue<PullingRefreshStatus>(
    PullingRefreshStatus.IDLE
  );
  const containerY = useSharedValue(0);
  const contentY = useSharedValue(0);
  const scrollerOffsetY = useSharedValue(0);
  const panTranslateY = useSharedValue(0);

  // TODO: By ClassComponent ?
  const onPulldownLoading = async () => {
    const res = onPulldownRefresh() as unknown;

    if (isPromise(res)) {
      await res;
    }

    runOnUI(() => {
      pulldownState.value = PullingRefreshStatus.BACKUP;
      panTranslateY.value = withAnimation(0, () => {
        pulldownState.value = PullingRefreshStatus.IDLE;
      });
    })();
  };

  const onPullupLoading = async () => {
    const res = onPullupRefresh() as unknown;

    if (isPromise(res)) {
      await res;
    }

    runOnUI(() => {
      pullupState.value = PullingRefreshStatus.BACKUP;
      panTranslateY.value = withAnimation(0, () => {
        pullupState.value = PullingRefreshStatus.IDLE;
      });
    })();
  };

  const canPulldown = useDerivedValue(
    () => scrollerOffsetY.value <= SystemOffset
  );

  const canPullup = useDerivedValue(
    () =>
      scrollerOffsetY.value - (contentY.value - containerY.value) >=
        -SystemOffset && enablePullup,
    [enablePullup]
  );

  const native = Gesture.Native();
  const panGesture = Gesture.Pan()
    .onStart(event => {
      if (
        [pulldownState.value, pullupState.value].includes(
          PullingRefreshStatus.LOADING
        )
      ) {
        return;
      }

      if (
        canPulldown.value &&
        pulldownState.value === PullingRefreshStatus.IDLE &&
        event.velocityY > 0
      ) {
        pulldownState.value = PullingRefreshStatus.PULLING;
      }

      if (
        canPullup.value &&
        pullupState.value === PullingRefreshStatus.IDLE &&
        event.velocityY < 0
      ) {
        pullupState.value = PullingRefreshStatus.PULLING;
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions, @typescript-eslint/no-unnecessary-condition, no-console
      LogFlag && console.log('onStart', pulldownState.value, pullupState.value);
    })
    .onChange(event => {
      if (
        [pulldownState.value, pullupState.value].includes(
          PullingRefreshStatus.LOADING
        )
      ) {
        return;
      }

      if (event.translationY > 0) {
        // down
        if (pullupState.value !== PullingRefreshStatus.IDLE) {
          pullupState.value = PullingRefreshStatus.IDLE;
        }

        if (canPulldown.value) {
          pulldownState.value =
            actuallyMove(event.translationY, containerY.value) >
            pulldownHeight * pullingFactor
              ? PullingRefreshStatus.PULLINGGO
              : PullingRefreshStatus.PULLING;
        }
      }

      if (event.translationY < 0) {
        // up
        if (pulldownState.value !== PullingRefreshStatus.IDLE) {
          pulldownState.value = PullingRefreshStatus.IDLE;
        }

        if (canPullup.value) {
          pullupState.value =
            actuallyMove(-event.translationY, containerY.value) >
            pullupHeight * pullingFactor
              ? PullingRefreshStatus.PULLINGGO
              : PullingRefreshStatus.PULLING;
        }
      }

      if (
        ([
          PullingRefreshStatus.PULLING,
          PullingRefreshStatus.PULLINGGO,
        ].includes(pulldownState.value) &&
          canPulldown.value) ||
        ([
          PullingRefreshStatus.PULLING,
          PullingRefreshStatus.PULLINGGO,
        ].includes(pullupState.value) &&
          canPullup.value)
      ) {
        panTranslateY.value = event.translationY;
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions, @typescript-eslint/no-unnecessary-condition
      LogFlag &&
        // eslint-disable-next-line no-console
        console.log(
          scrollerOffsetY.value,
          contentY.value - containerY.value,
          contentY.value,
          containerY.value,
          scrollerOffsetY.value - (contentY.value - containerY.value)
        );

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions, @typescript-eslint/no-unnecessary-condition
      LogFlag &&
        // eslint-disable-next-line no-console
        console.log('onChange', pulldownState.value, pullupState.value);
    })
    .onEnd(() => {
      if (canPulldown.value) {
        if (pulldownState.value !== PullingRefreshStatus.IDLE) {
          pulldownState.value =
            panTranslateY.value >= pulldownHeight * pullingFactor
              ? PullingRefreshStatus.PULLINGBACK
              : PullingRefreshStatus.BACKUP;

          if (pulldownState.value === PullingRefreshStatus.BACKUP) {
            panTranslateY.value = withAnimation(0, () => {
              pulldownState.value = PullingRefreshStatus.IDLE;
            });
          }

          if (pulldownState.value === PullingRefreshStatus.PULLINGBACK) {
            panTranslateY.value = withAnimation(pulldownHeight, () => {
              pulldownState.value = PullingRefreshStatus.LOADING;
              runOnJS(onPulldownLoading)();
            });
          }
        }
      }

      if (canPullup.value) {
        if (pullupState.value !== PullingRefreshStatus.IDLE) {
          pullupState.value =
            -panTranslateY.value >= pullupHeight * pullingFactor
              ? PullingRefreshStatus.PULLINGBACK
              : PullingRefreshStatus.BACKUP;

          if (pullupState.value === PullingRefreshStatus.BACKUP) {
            panTranslateY.value = withAnimation(0, () => {
              pullupState.value = PullingRefreshStatus.IDLE;
            });
          }

          if (pullupState.value === PullingRefreshStatus.PULLINGBACK) {
            panTranslateY.value = withAnimation(-pullupHeight, () => {
              pullupState.value = PullingRefreshStatus.LOADING;
              runOnJS(onPullupLoading)();
            });
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions, @typescript-eslint/no-unnecessary-condition, no-console
      LogFlag && console.log('onEnd', pulldownState.value, pullupState.value);
    });

  const contentAnimation = useAnimatedStyle(() => {
    const isPulldown = pulldownState.value !== PullingRefreshStatus.IDLE;
    let input = [0, pulldownHeight, containerY.value];
    let output = [0, pulldownHeight, containerY.value * containerFactor];

    if (!isPulldown) {
      input = [-containerY.value, -pullupHeight, 0];
      output = [-containerY.value * containerFactor, -pullupHeight, 0];
    }

    return {
      /**
       *    FIXME: #issue 👀
       *           Pullup to bounce back failed during the quick move down to up
       *           at the bottom on ios and android simulator.
       *           However, it works fine on the real device.
       *           Maybe the simulator cant tracking gestures by mouse normally.
       *  */
      pointerEvents:
        pullupState.value !== PullingRefreshStatus.IDLE ||
        pulldownState.value !== PullingRefreshStatus.IDLE
          ? 'none'
          : 'auto',
      transform: [
        {
          translateY: interpolate(
            panTranslateY.value,
            input,
            output,
            Extrapolate.CLAMP
          ),
        },
      ],
    };
  });

  const onScroll = useAnimatedScrollHandler((event: NativeScrollEvent) => {
    scrollerOffsetY.value = event.contentOffset.y;
    // LogFlag && console.log('onScroll', event.contentOffset);

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (children.onScroll) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      runOnJS(children.onScroll)(event);
    }
  });

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      containerY.value = event.nativeEvent.layout.height;
    },
    [containerY]
  );

  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentY.value = height;

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (children.onContentSizeChange) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        children.onContentSizeChange(event);
      }
    },
    [contentY, children]
  );
  const childStyle = [
    styles.flex,
    styles.zTop,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    children?.props?.style,
    contentAnimation,
  ];

  return (
    <MrPullRefreshContext.Provider
      value={{
        pulldownState,
        pullupState,
        panTranslateY,
        scrollerOffsetY,
        contentY,
        containerY,
        pulldownHeight,
        pullupHeight,
        pullingFactor,
        containerFactor,
      }}
    >
      <View style={[styles.flex, styles.overhidden, style]}>
        {pulldownLoading}
        <GestureDetector gesture={Gesture.Simultaneous(panGesture, native)}>
          {React.cloneElement(checkChildren(children as React.ReactElement), {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            onContentSizeChange,
            onScroll,
            bounces: false,
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            style: childStyle,
            scrollEventThrottle: 16,
            onLayout,
          })}
        </GestureDetector>
        {enablePullup && pullupLoading}
      </View>
    </MrPullRefreshContext.Provider>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  zTop: {
    zIndex: 2,
  },
  overhidden: {
    overflow: 'hidden',
  },
});

export const MrPullRefresh = memo(MrRefreshWrapper);
