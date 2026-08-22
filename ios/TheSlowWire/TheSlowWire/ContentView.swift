//
//  ContentView.swift
//  TheSlowWire
//
//  Created by Özkan Selçuk on 22/08/2026.
//

import SwiftUI

struct ContentView: View {
    @State private var selection: Vertical = .ai

    var body: some View {
        TabView(selection: $selection) {
            ForEach(Vertical.allCases) { vertical in
                SectionView(vertical: vertical)
                    .tag(vertical)
                    .tabItem {
                        Label(vertical.title, systemImage: vertical.symbol)
                    }
            }
        }
        .tint(selection.color)
    }
}

#Preview {
    ContentView()
}
