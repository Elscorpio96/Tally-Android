package com.tally.shopledger;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TallyPrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
