//
//  ContentView.swift
//  TheSlowWire
//
//  Created by Özkan Selçuk on 22/08/2026.
//

import SwiftUI

struct ContentView: View {
    @State private var selection: Vertical = .ai
    @State private var deepLink: DeepLinkTarget?

    var body: some View {
        // TabView keeps each world's state (feed, scroll, navigation) alive
        // across switches; its own bar is hidden — the SectionSwitch inside
        // each SectionView is the visible control, in the design language.
        TabView(selection: $selection) {
            ForEach(Vertical.allCases) { vertical in
                SectionView(vertical: vertical, selection: $selection, deepLink: $deepLink)
                    .tag(vertical)
            }
        }
        .tint(selection.color)
        .onOpenURL { url in
            guard let target = DeepLinkTarget.parse(url) else { return }
            selection = target.section
            deepLink = target
        }
    }
}

#Preview {
    ContentView()
}
