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
        TabView(selection: $selection) {
            ForEach(Vertical.allCases) { vertical in
                SectionView(vertical: vertical, deepLink: $deepLink)
                    .tag(vertical)
                    .tabItem {
                        Label(vertical.title, systemImage: vertical.symbol)
                    }
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
