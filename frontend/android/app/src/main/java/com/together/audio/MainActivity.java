package com.together.audio;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TogetherAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
