import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';

interface RaccoProps {
  state?: 'idle' | 'talking' | 'listening' | 'thinking' | 'happy' | 'sleeping';
  size?: number;
  onPress?: () => void;
  showSpeechBubble?: boolean;
  speechText?: string;
}

const Racco: React.FC<RaccoProps> = ({
  state = 'idle',
  size = 120,
  onPress,
  showSpeechBubble = false,
  speechText = '',
}) => {
  const blink = useRef(new Animated.Value(1)).current;
  const breathe = useRef(new Animated.Value(1)).current;
  const mouthV = useRef(new Animated.Value(0)).current;
  const zzzV = useRef(new Animated.Value(0)).current;
  const starV = useRef(new Animated.Value(0.3)).current;
  const s = (r: number) => size * r;

  useEffect(() => {
    if (state === 'idle') {
      const l = Animated.loop(Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 150, delay: 2500, useNativeDriver: false }),
        Animated.timing(blink, { toValue: 1, duration: 150, useNativeDriver: false }),
      ]));
      l.start(); return () => l.stop();
    }
    blink.setValue(1);
  }, [state, blink]);

  useEffect(() => {
    const l = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1.03, duration: 1500, useNativeDriver: false }),
      Animated.timing(breathe, { toValue: 0.97, duration: 1500, useNativeDriver: false }),
    ]));
    l.start(); return () => l.stop();
  }, [breathe]);

  useEffect(() => {
    if (state === 'talking') {
      const l = Animated.loop(Animated.sequence([
        Animated.timing(mouthV, { toValue: 1, duration: 200, useNativeDriver: false }),
        Animated.timing(mouthV, { toValue: 0, duration: 200, useNativeDriver: false }),
      ]));
      l.start(); return () => l.stop();
    }
    mouthV.setValue(0);
  }, [state, mouthV]);

  useEffect(() => {
    if (state === 'sleeping') {
      const l = Animated.loop(Animated.sequence([
        Animated.timing(zzzV, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(zzzV, { toValue: 0, duration: 400, useNativeDriver: false }),
      ]));
      l.start(); return () => l.stop();
    }
    zzzV.setValue(0);
  }, [state, zzzV]);

  useEffect(() => {
    if (state === 'happy') {
      const l = Animated.loop(Animated.sequence([
        Animated.timing(starV, { toValue: 1, duration: 600, useNativeDriver: false }),
        Animated.timing(starV, { toValue: 0.3, duration: 600, useNativeDriver: false }),
      ]));
      l.start(); return () => l.stop();
    }
    starV.setValue(0.3);
  }, [state, starV]);

  const es = state === 'listening' ? s(0.18) : s(0.13);
  const ei = state === 'listening' ? s(0.09) : s(0.06);
  const et = state === 'listening' ? -s(0.07) : -s(0.03);
  const mW = mouthV.interpolate({ inputRange: [0, 1], outputRange: [s(0.06), s(0.10)] });
  const mH = mouthV.interpolate({ inputRange: [0, 1], outputRange: [s(0.02), s(0.07)] });

  const raccoon = (
    <Animated.View style={{ transform: [{ scale: breathe }], alignItems: 'center' }}>
      {/* Head */}
      <View style={[S.head, { width: s(0.82), height: s(0.76) }]}>
        {/* Cap for sleeping */}
        {state === 'sleeping' && (
          <View style={[S.capWrap, { top: -s(0.18), left: s(0.08) }]}>
            <View style={{
              width: 0, height: 0,
              borderLeftWidth: s(0.09), borderRightWidth: s(0.09),
              borderBottomWidth: s(0.18),
              borderLeftColor: 'transparent', borderRightColor: 'transparent',
              borderBottomColor: '#7B68EE',
              transform: [{ rotate: '-15deg' }],
            }} />
            <View style={{
              width: s(0.06), height: s(0.06), borderRadius: s(0.03),
              backgroundColor: '#fff', position: 'absolute', top: -s(0.14), left: s(0.06),
            }} />
            <View style={{
              width: s(0.20), height: s(0.03), backgroundColor: '#6A5ACD',
              borderRadius: s(0.015), position: 'absolute', bottom: 0, left: -s(0.01),
            }} />
          </View>
        )}
        {/* Ears */}
        <View style={[S.ear, { width: es, height: es, top: et, left: s(0.02), borderRadius: es / 2 }]}>
          <View style={{ width: ei, height: ei, borderRadius: ei / 2, backgroundColor: '#C4A882' }} />
        </View>
        <View style={[S.ear, { width: es, height: es, top: et, right: s(0.02), borderRadius: es / 2 }]}>
          <View style={{ width: ei, height: ei, borderRadius: ei / 2, backgroundColor: '#C4A882' }} />
        </View>
        {/* White muzzle */}
        <View style={[S.muzzle, { width: s(0.50), height: s(0.38), top: s(0.16), borderRadius: s(0.22) }]} />
        {/* Eyes */}
        {state === 'sleeping' ? (
          <View style={[S.eyeRow, { top: s(0.22) }]}>
            <View style={[S.patch, { marginRight: s(0.02) }]}>
              <View style={{ width: s(0.09), height: s(0.012), backgroundColor: '#333', borderRadius: s(0.006) }} />
            </View>
            <View style={[S.patch, { marginLeft: s(0.02) }]}>
              <View style={{ width: s(0.09), height: s(0.012), backgroundColor: '#333', borderRadius: s(0.006) }} />
            </View>
          </View>
        ) : state === 'happy' ? (
          <View style={[S.eyeRow, { top: s(0.22) }]}>
            <View style={[S.patch, { marginRight: s(0.02) }]}>
              <View style={{ width: s(0.08), height: s(0.04), borderLeftWidth: s(0.007), borderTopWidth: s(0.007), borderColor: '#333', borderRightColor: 'transparent', borderBottomColor: 'transparent', borderRadius: s(0.04), transform: [{ rotate: '-45deg' }] }} />
            </View>
            <View style={[S.patch, { marginLeft: s(0.02) }]}>
              <View style={{ width: s(0.08), height: s(0.04), borderLeftWidth: s(0.007), borderTopWidth: s(0.007), borderColor: '#333', borderRightColor: 'transparent', borderBottomColor: 'transparent', borderRadius: s(0.04), transform: [{ rotate: '-45deg' }] }} />
            </View>
          </View>
        ) : (
          <Animated.View style={[S.eyeRow, { top: s(0.22), opacity: blink }]}>
            <View style={[S.patch, { marginRight: s(0.02) }]}>
              <View style={{ width: s(0.08), height: s(0.08), borderRadius: s(0.04), backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: s(0.035), height: s(0.035), borderRadius: s(0.018), backgroundColor: '#222' }} />
              </View>
            </View>
            <View style={[S.patch, { marginLeft: s(0.02) }]}>
              <View style={{ width: s(0.08), height: s(0.08), borderRadius: s(0.04), backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: s(0.035), height: s(0.035), borderRadius: s(0.018), backgroundColor: '#222' }} />
              </View>
            </View>
          </Animated.View>
        )}
        {/* Nose */}
        <View style={{ width: s(0.045), height: s(0.035), borderRadius: s(0.02), backgroundColor: '#222', position: 'absolute', top: s(0.40), alignSelf: 'center' }} />
        {/* Mouth */}
        {state === 'talking' ? (
          <Animated.View style={{ width: mW, height: mH, borderRadius: s(0.05), backgroundColor: '#A0522D', position: 'absolute', top: s(0.46), alignSelf: 'center' }} />
        ) : state === 'happy' ? (
          <View style={{ position: 'absolute', top: s(0.46), alignSelf: 'center' }}>
            <View style={{ width: s(0.09), height: s(0.05), borderBottomWidth: s(0.009), borderBottomColor: '#555', borderRadius: s(0.05) }} />
          </View>
        ) : state === 'sleeping' ? null : (
          <View style={{ position: 'absolute', top: s(0.47), alignSelf: 'center' }}>
            <View style={{ width: s(0.06), height: s(0.03), borderBottomWidth: s(0.007), borderBottomColor: '#555', borderRadius: s(0.03) }} />
          </View>
        )}
        {/* Thinking hand */}
        {state === 'thinking' && (
          <View style={{ width: s(0.11), height: s(0.11), borderRadius: s(0.055), backgroundColor: '#8B8B8B', position: 'absolute', bottom: s(0.20), right: -s(0.02) }} />
        )}
      </View>
      {/* Body */}
      <View style={{ width: s(0.56), height: s(0.36), borderRadius: s(0.18), backgroundColor: '#8B8B8B', marginTop: -s(0.06) }} />
      {/* Tail */}
      <View style={[S.tail, { bottom: s(0.10), right: -s(0.12) }]}>
        {[0,1,2,3,4].map(i => (
          <View key={i} style={{
            height: s(0.03), width: s(0.09) - i * s(0.004),
            borderRadius: s(0.015), marginTop: i === 0 ? 0 : s(0.003),
            backgroundColor: i % 2 === 0 ? '#8B8B8B' : '#555',
          }} />
        ))}
      </View>
      {/* Zzz */}
      {state === 'sleeping' && (
        <Animated.View style={{
          position: 'absolute', top: -s(0.04), right: -s(0.08),
          opacity: zzzV,
          transform: [{ translateY: zzzV.interpolate({ inputRange: [0, 1], outputRange: [0, -s(0.10)] }) }],
        }}>
          <Text style={{ fontSize: s(0.09), color: '#7B68EE', fontWeight: 'bold' }}>Z</Text>
          <Text style={{ fontSize: s(0.07), color: '#7B68EE', fontWeight: 'bold', marginLeft: s(0.04) }}>z</Text>
          <Text style={{ fontSize: s(0.05), color: '#7B68EE', fontWeight: 'bold', marginLeft: s(0.07) }}>z</Text>
        </Animated.View>
      )}
      {/* Stars */}
      {state === 'happy' && (
        <Animated.View style={{ position: 'absolute', top: s(0.04), right: -s(0.08), opacity: starV }}>
          <Text style={{ fontSize: s(0.11), color: '#FFD700' }}>✦</Text>
          <Text style={{ fontSize: s(0.07), color: '#FFD700', marginLeft: s(0.08), marginTop: s(0.02) }}>✦</Text>
        </Animated.View>
      )}
      {/* Moon pillow */}
      {state === 'sleeping' && (
        <View style={{ position: 'absolute', bottom: s(0.04), left: s(0.06), width: s(0.16), height: s(0.16) }}>
          <View style={{ width: s(0.14), height: s(0.14), borderRadius: s(0.07), backgroundColor: '#FFD700' }} />
          <View style={{ width: s(0.10), height: s(0.10), borderRadius: s(0.05), backgroundColor: '#fff', position: 'absolute', top: s(0.02), left: s(0.06) }} />
        </View>
      )}
    </Animated.View>
  );

  return (
    <View style={{ alignItems: 'center' }}>
      {showSpeechBubble && speechText ? (
        <View style={[S.bubble, { marginBottom: s(0.04) }]}>
          <Text style={[S.bubbleText, { fontSize: s(0.08) }]}>{speechText}</Text>
          <View style={S.arrow} />
        </View>
      ) : null}
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        {raccoon}
      </TouchableOpacity>
    </View>
  );
};

const S = StyleSheet.create({
  head: { position: 'relative', backgroundColor: '#8B8B8B', borderRadius: 100, alignItems: 'center', justifyContent: 'center' },
  ear: { position: 'absolute', backgroundColor: '#8B8B8B', alignItems: 'center', justifyContent: 'center' },
  muzzle: { position: 'absolute', backgroundColor: '#fff' },
  eyeRow: { position: 'absolute', flexDirection: 'row', alignSelf: 'center' },
  patch: { backgroundColor: '#555', borderRadius: 20, padding: 4, alignItems: 'center', justifyContent: 'center' },
  tail: { position: 'absolute', alignItems: 'flex-end', transform: [{ rotate: '-30deg' }] },
  capWrap: { position: 'absolute', alignItems: 'center' },
  bubble: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', elevation: 2, maxWidth: 240, alignItems: 'center' },
  bubbleText: { color: '#555', textAlign: 'center' },
  arrow: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff', marginTop: 2 },
});

export default Racco;
